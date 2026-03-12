import fs from "node:fs/promises";
import path from "node:path";
import { clearApplyLock, setApplyLock } from "../adapters/apply-lock";
import { NodeConflictDecisionStore } from "../adapters/node-conflict-decision-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import { RemoteFolderSyncProvider } from "../adapters/remote-folder-sync-provider";
import { VaultEventApplier } from "../adapters/vault-event-applier";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { withRetry } from "../application/with-retry";
import { sleep } from "../infra/sleep";
import type { ConflictResolutionStrategy } from "../ports/conflict-decision-store";
import type { FileHash } from "../ports/file-hasher";
import { resolveKeepLocal } from "../services/keep-local";
import { resolveKeepRemote } from "../services/keep-remote";
import { compareAllStates } from "../services/sync-diff";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { HistoryEvent } from "../value-objects/history-event";

const retryPolicy = defaultNetworkRetryPolicy();

/**
 * Normaliza diferentes formatos de hash para string.
 *
 * @param h Valor bruto do hash.
 * @returns Hash normalizado ou `undefined`.
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
 * Reconcila o estado sincronizado com base nos hashes local e remoto.
 *
 * Quando `lastLocalHash` e `lastRemoteHash` são iguais, o arquivo é considerado sincronizado
 * e `lastSyncedHash` passa a refletir esse valor. Quando ambos não existem, `lastSyncedHash`
 * também é removido.
 *
 * @param state Estado parcial do arquivo.
 */
function reconcileSynced(state: Partial<FileSyncState>): void {
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
 * @param p Caminho a verificar.
 * @returns `true` quando o caminho existir.
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
 * Emite aviso quando o caminho informado provavelmente não aponta para a raiz correta do vault.
 *
 * A função tenta localizar uma pasta `.obsidian` no diretório informado e também em subpastas
 * imediatas para sugerir um caminho mais provável.
 *
 * @param vaultAbs Caminho absoluto do vault local.
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
 * Obtém o hash associado a um evento de histórico.
 *
 * @param event Evento de histórico.
 * @returns Hash do evento ou `undefined`.
 */
function pickHashFromEvent(event: HistoryEvent): FileHash | undefined {
	return event.change?.hash;
}

/**
 * Verifica se um evento representa exclusão de arquivo.
 *
 * @param event Evento de histórico.
 * @returns `true` quando o evento for de deleção.
 */
function isDeletedEvent(event: HistoryEvent): boolean {
	return event.change?.changeType === "deleted";
}

/**
 * Obtém o path associado ao evento.
 *
 * @param event Evento de histórico.
 * @returns Caminho do arquivo afetado.
 */
function getEventPath(event: HistoryEvent): string {
	return event.change.path;
}

/**
 * Obtém o tipo de alteração associado ao evento.
 *
 * @param event Evento de histórico.
 * @returns Tipo da alteração.
 */
function getEventChangeType(event: HistoryEvent): string {
	return event.change.changeType;
}

/**
 * Obtém o hash normalizado de um evento.
 *
 * @param event Evento de histórico.
 * @returns Hash normalizado ou `undefined`.
 */
function getEventNormalizedHash(event: HistoryEvent): string | undefined {
	return normalizeHash(event.change.hash);
}

/**
 * Constrói um mapa contendo apenas o evento mais recente de cada path.
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
 * Lê todos os eventos do histórico local armazenados em arquivos `.jsonl`.
 *
 * Linhas inválidas são ignoradas silenciosamente para evitar que um registro corrompido
 * interrompa a sincronização inteira.
 *
 * @param localHistoryDir Diretório de histórico local.
 * @returns Lista de eventos válidos encontrados.
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
			try {
				events.push(JSON.parse(line) as HistoryEvent);
			} catch {}
		}
	}

	return events;
}

/**
 * Remove eventos locais redundantes do tipo `modified` quando não houve mudança real de hash.
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
 * Cria uma assinatura semântica do evento para deduplicação.
 *
 * A assinatura considera path, tipo de alteração e hash, ignorando timestamp.
 *
 * @param event Evento de histórico.
 * @returns Assinatura textual do evento.
 */
function buildSemanticSignature(event: HistoryEvent): string {
	return `${getEventPath(event)}|${getEventChangeType(event)}|${getEventNormalizedHash(event)}`;
}

/**
 * Executa o fluxo completo de sincronização entre o vault local e a pasta remota.
 *
 * O fluxo inclui:
 * - leitura do histórico local
 * - pull incremental remoto
 * - detecção e resolução de conflitos
 * - aplicação de eventos remotos
 * - atualização de cursor
 * - push incremental local
 * - consolidação final de estado
 */
async function main(): Promise<void> {
	const localVault = process.argv[2];
	const remoteRoot = process.argv[3];
	const strategyArg = (process.argv[4] ?? "local").toLowerCase();

	if (!localVault || !remoteRoot) {
		console.error(
			'Uso: pnpm dev:sync-remote -- "<vaultLocal>" "<pastaRemota>" [local|remote]',
		);
		process.exit(1);
	}

	const strategy: ConflictResolutionStrategy =
		strategyArg === "remote" ? "remote" : "local";

	const vaultAbs = path.resolve(localVault);
	const remoteAbs = path.resolve(remoteRoot);

	await warnIfProbablyWrongVaultPath(vaultAbs);

	const vaultIdForRemote = path.basename(vaultAbs);
	const provider = new RemoteFolderSyncProvider(remoteAbs, vaultIdForRemote);

	const cursorStore = new NodeRemoteCursorStore();
	const applier = new VaultEventApplier();

	const hasher = new NodeFileHasher();
	const stateStore = new NodeSyncStateStore();
	const historyRepository = new NodeHistoryRepository();
	const decisionStore = new NodeConflictDecisionStore();

	const nowIso = () => new Date().toISOString();

	/**
	 * Atualiza parcialmente o estado de sincronização de um arquivo.
	 *
	 * Quando `lastSyncedHash` não é informado explicitamente, ele é recalculado com base
	 * na reconciliação entre estado local e remoto.
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

	const cursor = await cursorStore.load(vaultAbs);
	console.log("Pull a partir do cursor:", cursor?.value ?? "null");

	const { events: pulled, nextCursor } = await withRetry(
		() => provider.pullHistoryEvents(cursor),
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

	const remoteAllNowRes = await withRetry(
		() => provider.pullHistoryEvents(null),
		retryPolicy,
		sleep,
	);

	const remoteAllNow = remoteAllNowRes.events;

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

	if (toApply.length > 0) {
		await setApplyLock(vaultAbs);

		try {
			await applier.apply(vaultAbs, toApply);
		} finally {
			await clearApplyLock(vaultAbs);
		}

		const latestAppliedByPath = buildLatestByPath(toApply);

		for (const [eventPath, event] of latestAppliedByPath.entries()) {
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

	await cursorStore.save(vaultAbs, nextCursor ?? cursor);

	const finalStatesBeforePush = await stateStore.loadAll(vaultAbs);
	const { conflicts: finalConflictsBeforePush } = compareAllStates(
		finalStatesBeforePush,
	);

	const blockedPaths = new Set(
		finalConflictsBeforePush.map((conflict) => conflict.path),
	);

	const refreshedLocalEvents = await readAllLocalHistory(localHistoryDir);
	const localCandidates = dedupeLocalNoHashChange(refreshedLocalEvents);

	const remoteAllBeforePushRes = await withRetry(
		() => provider.pullHistoryEvents(null),
		retryPolicy,
		sleep,
	);

	const remoteAllBeforePush = remoteAllBeforePushRes.events;

	const remoteIds = new Set(remoteAllBeforePush.map((event) => event.id));

	const remoteSemanticSigs = new Set(
		remoteAllBeforePush.map(buildSemanticSignature),
	);

	const toPush = localCandidates.filter(
		(event) =>
			!blockedPaths.has(getEventPath(event)) &&
			!remoteIds.has(event.id) &&
			!remoteSemanticSigs.has(buildSemanticSignature(event)),
	);

	const remoteEventsById = new Map(
		remoteAllBeforePush.map((event) => [event.id, event] as const),
	);

	await withRetry(() => provider.pushHistoryEvents(toPush), retryPolicy, sleep);

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

	console.log("Push OK:", toPush.length, "novos eventos enviados.");

	const alreadyInRemote = refreshedLocalEvents.filter((event) =>
		remoteEventsById.has(event.id),
	);

	const latestAckedByPath = buildLatestByPath(alreadyInRemote);

	for (const [eventPath, event] of latestAckedByPath.entries()) {
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

	const allStatesAfter = await stateStore.loadAll(vaultAbs);
	const { conflicts: conflictsAfter, comparisons: comparisonsAfter } =
		compareAllStates(allStatesAfter);

	console.log("Resumo (final):", {
		total: comparisonsAfter.length,
		conflicts: conflictsAfter.length,
		localChanged: comparisonsAfter.filter((c) => c.status === "local_changed")
			.length,
		remoteChanged: comparisonsAfter.filter((c) => c.status === "remote_changed")
			.length,
		synced: comparisonsAfter.filter((c) => c.status === "synced").length,
	});

	if (conflictsAfter.length > 0) {
		console.log("⚠️ Conflitos restantes:");
		for (const conflict of conflictsAfter) {
			console.log(`- ${conflict.path} [${conflict.type}]`);
		}
	} else if (blockedPaths.size > 0) {
		console.log(
			"✅ Nenhum conflito restante. Paths que foram bloqueados do push nesta execução:",
			[...blockedPaths],
		);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
