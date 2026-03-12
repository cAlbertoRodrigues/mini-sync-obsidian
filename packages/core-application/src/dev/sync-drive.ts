import fs from "node:fs/promises";
import path from "node:path";
import { clearApplyLock, setApplyLock } from "../adapters/apply-lock";
import { GoogleAuth } from "../adapters/google-auth";
import { GoogleDriveSyncProvider } from "../adapters/google-drive-sync-provider";
import { NodeConflictDecisionStore } from "../adapters/node-conflict-decision-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import { VaultEventApplier } from "../adapters/vault-event-applier";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { withRetry } from "../application/with-retry";
import { sleep } from "../infra/sleep";
import type { ConflictResolutionStrategy } from "../ports/conflict-decision-store";
import type { FileHash } from "../ports/file-hasher";
import type { SyncCursor } from "../ports/sync-provider";
import { resolveKeepLocal } from "../services/keep-local";
import { resolveKeepRemote } from "../services/keep-remote";
import { compareAllStates } from "../services/sync-diff";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { HistoryEvent } from "../value-objects/history-event";

const retryPolicy = defaultNetworkRetryPolicy();

/**
 * Normaliza diferentes formatos possíveis de hash para string.
 *
 * @param h Valor bruto do hash.
 * @returns Hash normalizado como string ou `undefined`.
 */
function normalizeHash(h: unknown): string | undefined {
	if (!h) return undefined;
	if (typeof h === "string") return h;
	if (typeof h === "object" && h !== null && "value" in h) {
		const value = (h as { value?: unknown }).value;
		return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

/**
 * Reconcila o campo `lastSyncedHash` com base em `lastLocalHash` e `lastRemoteHash`.
 *
 * Quando os hashes local e remoto são iguais, o estado é considerado sincronizado.
 * Quando ambos não existem, `lastSyncedHash` também é removido.
 *
 * @param state Estado parcial de sincronização do arquivo.
 */
function reconcileSynced(state: Partial<FileSyncState>) {
	const lh = normalizeHash(
		(state as Partial<FileSyncState> & { lastLocalHash?: unknown })
			.lastLocalHash,
	);
	const rh = normalizeHash(
		(state as Partial<FileSyncState> & { lastRemoteHash?: unknown })
			.lastRemoteHash,
	);

	if (lh && rh && lh === rh) {
		(
			state as Partial<FileSyncState> & { lastSyncedHash?: unknown }
		).lastSyncedHash = (
			state as Partial<FileSyncState> & { lastLocalHash?: unknown }
		).lastLocalHash;
		return;
	}

	if (!lh && !rh) {
		(
			state as Partial<FileSyncState> & { lastSyncedHash?: undefined }
		).lastSyncedHash = undefined;
	}
}

/**
 * Verifica se um caminho existe no sistema de arquivos.
 *
 * @param p Caminho absoluto ou relativo.
 * @returns `true` se o caminho existir, caso contrário `false`.
 */
async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Emite um aviso caso o caminho informado provavelmente não seja a raiz correta do vault.
 *
 * A função procura a pasta `.obsidian` no caminho informado e também em subpastas imediatas
 * para sugerir uma possível correção.
 *
 * @param vaultAbs Caminho absoluto informado para o vault.
 */
async function warnIfProbablyWrongVaultPath(vaultAbs: string): Promise<void> {
	const obsidianHere = await exists(path.join(vaultAbs, ".obsidian"));
	if (obsidianHere) return;

	try {
		const children = await fs.readdir(vaultAbs, { withFileTypes: true });
		const candidates = children
			.filter((d) => d.isDirectory())
			.map((d) => d.name);

		for (const name of candidates) {
			const candidate = path.join(vaultAbs, name);
			if (await exists(path.join(candidate, ".obsidian"))) {
				console.warn(
					`Atenção: não encontrei ".obsidian" em "${vaultAbs}". ` +
						`Mas encontrei um vault em "${candidate}". ` +
						`Talvez você queira usar esse caminho.`,
				);
				return;
			}
		}
	} catch {}

	console.warn(
		`Aviso: não encontrei ".obsidian" em "${vaultAbs}". ` +
			`Se este for um vault novo, tudo bem.`,
	);
}

/**
 * Obtém o hash associado ao evento de histórico, quando existir.
 *
 * @param e Evento de histórico.
 * @returns Hash do evento ou `undefined`.
 */
function pickHashFromEvent(e: HistoryEvent): FileHash | undefined {
	return (e as HistoryEvent & { change?: { hash?: FileHash } }).change?.hash;
}

/**
 * Verifica se o evento representa uma deleção.
 *
 * @param e Evento de histórico.
 * @returns `true` se o evento for de exclusão.
 */
function isDeletedEvent(e: HistoryEvent): boolean {
	return (
		(e as HistoryEvent & { change?: { changeType?: string } }).change
			?.changeType === "deleted"
	);
}

/**
 * Obtém o caminho do arquivo afetado por um evento.
 *
 * @param e Evento de histórico.
 * @returns Caminho do arquivo.
 */
function getEventPath(e: HistoryEvent): string {
	return (e as HistoryEvent & { change: { path: string } }).change.path;
}

/**
 * Obtém o tipo de alteração associado a um evento.
 *
 * @param e Evento de histórico.
 * @returns Tipo da alteração.
 */
function getEventChangeType(e: HistoryEvent): string {
	return (e as HistoryEvent & { change: { changeType: string } }).change
		.changeType;
}

/**
 * Obtém o hash do evento em formato normalizado.
 *
 * @param e Evento de histórico.
 * @returns Hash normalizado ou `undefined`.
 */
function getEventNormalizedHash(e: HistoryEvent): string | undefined {
	return normalizeHash(
		(e as HistoryEvent & { change?: { hash?: unknown } }).change?.hash,
	);
}

/**
 * Constrói um mapa contendo apenas o evento mais recente de cada caminho.
 *
 * Os eventos são ordenados cronologicamente e o último evento de cada path é mantido.
 *
 * @param events Lista de eventos.
 * @returns Mapa indexado por path com o último evento correspondente.
 */
function buildLatestByPath(events: HistoryEvent[]): Map<string, HistoryEvent> {
	const sorted = [...events].sort((a, b) => {
		const aa = new Date(a.occurredAtIso).getTime();
		const bb = new Date(b.occurredAtIso).getTime();
		return aa - bb;
	});

	const map = new Map<string, HistoryEvent>();
	for (const event of sorted) {
		map.set(getEventPath(event), event);
	}

	return map;
}

/**
 * Remove eventos locais redundantes do tipo `modified` quando o hash não mudou.
 *
 * Isso reduz ruído gerado por watchers em salvamentos que não alteram o conteúdo real do arquivo.
 *
 * @param events Lista de eventos locais.
 * @returns Lista filtrada sem modificações redundantes.
 */
function dedupeLocalNoHashChange(events: HistoryEvent[]): HistoryEvent[] {
	const out: HistoryEvent[] = [];
	const lastHashByPath = new Map<string, string | undefined>();

	const sorted = [...events].sort((a, b) =>
		a.occurredAtIso < b.occurredAtIso
			? -1
			: a.occurredAtIso > b.occurredAtIso
				? 1
				: 0,
	);

	for (const event of sorted) {
		const eventPath = getEventPath(event);
		const eventType = getEventChangeType(event);
		const eventHash = getEventNormalizedHash(event);

		if (eventType === "modified") {
			const previousHash = lastHashByPath.get(eventPath);
			if (previousHash && eventHash && previousHash === eventHash) {
				continue;
			}
		}

		lastHashByPath.set(eventPath, eventHash);
		out.push(event);
	}

	return out;
}

/**
 * Lê todos os eventos de histórico local armazenados em arquivos `.jsonl`.
 *
 * @param localHistoryDir Diretório local de histórico.
 * @returns Lista completa de eventos encontrados.
 */
async function readAllLocalHistory(
	localHistoryDir: string,
): Promise<HistoryEvent[]> {
	let files: string[] = [];

	try {
		files = (await fs.readdir(localHistoryDir))
			.filter((file) => file.endsWith(".jsonl"))
			.sort();
	} catch {
		return [];
	}

	const events: HistoryEvent[] = [];

	for (const file of files) {
		const content = await fs.readFile(
			path.join(localHistoryDir, file),
			"utf-8",
		);
		const lines = content.split("\n").filter((line) => line.trim().length > 0);

		for (const line of lines) {
			events.push(JSON.parse(line) as HistoryEvent);
		}
	}

	return events;
}

/**
 * Gera uma assinatura semântica do evento para deduplicação.
 *
 * A assinatura considera caminho, tipo da alteração e hash, ignorando timestamp.
 *
 * @param event Evento de histórico.
 * @returns Assinatura textual do evento.
 */
function buildSemanticSignature(event: HistoryEvent): string {
	return `${getEventPath(event)}|${getEventChangeType(event)}|${getEventNormalizedHash(event)}`;
}

/**
 * Traduz erros comuns de autenticação do Google Drive em mensagens amigáveis.
 *
 * @param e Erro capturado.
 * @returns Mensagem amigável ou `null` quando o erro não for reconhecido.
 */
function friendlyAuthError(e: unknown): string | null {
	const msg = String((e as { message?: unknown })?.message ?? e);

	if (msg.includes("ENOENT") || msg.includes("google.credentials.json")) {
		return 'Credencial ausente: coloque "google.credentials.json" em ".mini-sync/secrets/" do vault.';
	}

	if (msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
		return 'Token inválido/expirado: apague ".mini-sync/secrets/google.tokens.json" e rode novamente para autenticar.';
	}

	return null;
}

/**
 * Executa o fluxo completo de sincronização entre o vault local e o Google Drive.
 *
 * O processo inclui:
 * - leitura do histórico local
 * - pull incremental remoto
 * - resolução de conflitos
 * - aplicação de eventos remotos
 * - persistência de cursor
 * - push incremental local
 * - atualização do cursor remoto
 */
async function main(): Promise<void> {
	const localVault = process.argv[2];
	const strategyArg = (process.argv[3] ?? "local").toLowerCase();
	const vaultIdArg = process.argv[4];

	if (!localVault) {
		console.error(
			'Uso: pnpm dev:sync-drive -- "<vaultAbs>" [local|remote] [vaultId]',
		);
		process.exit(1);
	}

	const strategy: ConflictResolutionStrategy =
		strategyArg === "remote" ? "remote" : "local";

	const vaultAbs = path.resolve(localVault);

	await warnIfProbablyWrongVaultPath(vaultAbs);

	const vaultId = vaultIdArg ?? path.basename(vaultAbs);

	const tokenDirAbs = path.join(vaultAbs, ".mini-sync", "secrets");
	const credentialsPathAbs = path.join(tokenDirAbs, "google.credentials.json");

	try {
		const ga = new GoogleAuth({ tokenDirAbs, credentialsPathAbs });
		const auth = await ga.getAuthorizedClient();

		const provider = new GoogleDriveSyncProvider(auth, vaultId);
		const cursorStore = new NodeRemoteCursorStore(`drive.${vaultId}`);
		const applier = new VaultEventApplier();

		const hasher = new NodeFileHasher();
		const stateStore = new NodeSyncStateStore();
		const historyRepository = new NodeHistoryRepository();
		const decisionStore = new NodeConflictDecisionStore();

		const nowIso = () => new Date().toISOString();

		/**
		 * Atualiza parcialmente o estado sincronizado de um arquivo, preservando os demais campos.
		 *
		 * Se `lastSyncedHash` não for informado explicitamente, ele será recalculado por reconciliação.
		 *
		 * @param patch Patch parcial contendo o path e os campos a atualizar.
		 */
		async function upsertStatePatch(
			patch: Partial<FileSyncState> & { path: string },
		): Promise<void> {
			const prev = await stateStore.get(vaultAbs, patch.path);

			const merged: FileSyncState = {
				lastSyncedHash: prev?.lastSyncedHash,
				lastLocalHash: prev?.lastLocalHash,
				lastRemoteHash: prev?.lastRemoteHash,
				updatedAtIso: nowIso(),
				...patch,
			} as FileSyncState;

			const patchExplicitlySetSynced = Object.hasOwn(patch, "lastSyncedHash");

			if (!patchExplicitlySetSynced) {
				reconcileSynced(merged);
			}

			await stateStore.upsert(vaultAbs, merged);
		}

		const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");
		const allLocalEvents = await readAllLocalHistory(localHistoryDir);

		console.log("Eventos locais encontrados:", allLocalEvents.length);

		const latestLocalByPath = buildLatestByPath(allLocalEvents);

		for (const [eventPath, event] of latestLocalByPath.entries()) {
			if (isDeletedEvent(event)) {
				await upsertStatePatch({ path: eventPath, lastLocalHash: undefined });
			} else {
				const hash = pickHashFromEvent(event);
				if (hash) {
					await upsertStatePatch({ path: eventPath, lastLocalHash: hash });
				}
			}
		}

		const currentCursor: SyncCursor | null = await cursorStore.load(vaultAbs);
		console.log("Pull a partir do cursor:", currentCursor?.value ?? "null");

		const { events: pulled, nextCursor } = await withRetry(
			() => provider.pullHistoryEvents(currentCursor),
			retryPolicy,
			sleep,
		);

		console.log(
			"Pulled:",
			pulled.length,
			"nextCursor:",
			nextCursor?.value ?? "null",
		);

		const latestRemoteByPath = buildLatestByPath(pulled);

		for (const [eventPath, event] of latestRemoteByPath.entries()) {
			if (isDeletedEvent(event)) {
				await upsertStatePatch({ path: eventPath, lastRemoteHash: undefined });
			} else {
				const hash = pickHashFromEvent(event);
				if (hash) {
					await upsertStatePatch({ path: eventPath, lastRemoteHash: hash });
				}
			}
		}

		const allStatesBefore = await stateStore.loadAll(vaultAbs);
		const { conflicts: conflictsBefore, comparisons } =
			compareAllStates(allStatesBefore);

		console.log("Resumo (antes da resolução):", {
			total: comparisons.length,
			conflicts: conflictsBefore.length,
			localChanged: comparisons.filter((c) => c.status === "local_changed")
				.length,
			remoteChanged: comparisons.filter((c) => c.status === "remote_changed")
				.length,
			synced: comparisons.filter((c) => c.status === "synced").length,
		});

		const { events: remoteAllNow } = await withRetry(
			() => provider.pullHistoryEvents(null),
			retryPolicy,
			sleep,
		);

		if (conflictsBefore.length > 0) {
			console.log(
				`⚠️ Conflitos detectados (${conflictsBefore.length}). Estratégia padrão (CLI): manter ${strategy}.`,
			);

			for (const conflict of conflictsBefore) {
				const relativePath = conflict.path.replaceAll("\\", "/");

				const saved = await decisionStore.get(vaultAbs, relativePath);
				const chosen: ConflictResolutionStrategy = saved?.strategy ?? strategy;

				await decisionStore.set(vaultAbs, {
					path: relativePath,
					strategy: chosen,
					decidedAtIso: new Date().toISOString(),
				});

				if (chosen === "local") {
					await resolveKeepLocal({
						vaultRootAbs: vaultAbs,
						conflicts: [conflict],
						hasher,
						provider,
						historyRepository,
						stateStore,
					});
				} else {
					await resolveKeepRemote({
						vaultRootAbs: vaultAbs,
						conflicts: [conflict],
						pulledRemoteEvents: remoteAllNow,
						hasher,
						historyRepository,
						stateStore,
					});
				}

				console.log(
					`✅ Conflito resolvido (${relativePath}) com estratégia: ${chosen}`,
				);
			}
		}

		const statesAfterResolution = await stateStore.loadAll(vaultAbs);
		const { conflicts: conflictsAfterResolution } = compareAllStates(
			statesAfterResolution,
		);

		const conflictPaths = new Set(
			conflictsAfterResolution.map((conflict) => conflict.path),
		);

		const toApply = pulled.filter(
			(event) => !conflictPaths.has(getEventPath(event)),
		);

		console.log("Aplicando eventos remotos:", toApply.length);

		if (toApply.length > 0) {
			await setApplyLock(vaultAbs);

			try {
				await applier.apply(vaultAbs, toApply);
			} finally {
				await clearApplyLock(vaultAbs);
				await sleep(1500);
			}

			const latestApplied = buildLatestByPath(toApply);

			for (const [eventPath, event] of latestApplied.entries()) {
				if (isDeletedEvent(event)) {
					await upsertStatePatch({
						path: eventPath,
						lastSyncedHash: undefined,
						lastLocalHash: undefined,
						lastRemoteHash: undefined,
					});
				} else {
					const hash = pickHashFromEvent(event);
					if (!hash) continue;

					await upsertStatePatch({
						path: eventPath,
						lastSyncedHash: hash,
						lastLocalHash: hash,
						lastRemoteHash: hash,
					});
				}
			}
		}

		const cursorToSave = nextCursor ?? currentCursor;
		await cursorStore.save(vaultAbs, cursorToSave);

		const finalStatesBeforePush = await stateStore.loadAll(vaultAbs);
		const { conflicts: finalConflictsBeforePush } = compareAllStates(
			finalStatesBeforePush,
		);

		const blockedPaths = new Set(
			finalConflictsBeforePush.map((conflict) => conflict.path),
		);

		const refreshedLocalEvents = await readAllLocalHistory(localHistoryDir);

		const { events: remoteAllBeforePush } = await withRetry(
			() => provider.pullHistoryEvents(null),
			retryPolicy,
			sleep,
		);

		const remoteIds = new Set(
			remoteAllBeforePush.map((event: HistoryEvent) => event.id),
		);

		const remoteSemanticSigs = new Set(
			remoteAllBeforePush.map(buildSemanticSignature),
		);

		const localCandidates = dedupeLocalNoHashChange(refreshedLocalEvents);

		const toPush = localCandidates.filter(
			(event) =>
				!blockedPaths.has(getEventPath(event)) &&
				!remoteIds.has(event.id) &&
				!remoteSemanticSigs.has(buildSemanticSignature(event)),
		);

		await withRetry(
			() => provider.pushHistoryEvents(toPush),
			retryPolicy,
			sleep,
		);

		console.log("Push OK:", toPush.length, "novos eventos enviados.");

		const latestPushedByPath = buildLatestByPath(toPush);

		for (const [eventPath, event] of latestPushedByPath.entries()) {
			if (isDeletedEvent(event)) {
				await upsertStatePatch({
					path: eventPath,
					lastLocalHash: undefined,
					lastRemoteHash: undefined,
					lastSyncedHash: undefined,
				});
			} else {
				const hash = pickHashFromEvent(event);
				if (!hash) continue;

				await upsertStatePatch({
					path: eventPath,
					lastLocalHash: hash,
					lastRemoteHash: hash,
					lastSyncedHash: hash,
				});
			}
		}

		const pulledIso = cursorToSave?.value ?? null;
		const lastPushedEvent =
			toPush.length > 0 ? toPush[toPush.length - 1] : undefined;
		const pushedIso = lastPushedEvent?.occurredAtIso ?? null;

		let newRemoteIso: string | null = pulledIso ?? null;

		if (pulledIso && pushedIso) {
			newRemoteIso = pulledIso > pushedIso ? pulledIso : pushedIso;
		} else if (pushedIso) {
			newRemoteIso = pushedIso;
		}

		await provider.setRemoteCursor(
			newRemoteIso ? { value: newRemoteIso } : null,
		);

		console.log("Cursor remoto atualizado:", newRemoteIso ?? "null");

		await cursorStore.save(
			vaultAbs,
			newRemoteIso ? { value: newRemoteIso } : null,
		);

		console.log("Cursor local atualizado:", newRemoteIso ?? "null");

		const allStatesAfter = await stateStore.loadAll(vaultAbs);
		const { conflicts: conflictsAfter, comparisons: comparisonsAfter } =
			compareAllStates(allStatesAfter);

		console.log("Resumo (final):", {
			total: comparisonsAfter.length,
			conflicts: conflictsAfter.length,
			localChanged: comparisonsAfter.filter((c) => c.status === "local_changed")
				.length,
			remoteChanged: comparisonsAfter.filter(
				(c) => c.status === "remote_changed",
			).length,
			synced: comparisonsAfter.filter((c) => c.status === "synced").length,
		});

		if (conflictsAfter.length > 0) {
			console.log("⚠️ Conflitos restantes:");
			for (const conflict of conflictsAfter) {
				console.log(`- ${conflict.path} [${conflict.type}]`);
			}
		}
	} catch (e) {
		const friendly = friendlyAuthError(e);

		if (friendly) {
			console.error(friendly);
		} else {
			console.error(e);
		}

		process.exit(1);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});