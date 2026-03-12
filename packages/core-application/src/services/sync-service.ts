import fs from "node:fs/promises";
import path from "node:path";
import { clearApplyLock, setApplyLock } from "../adapters/apply-lock";
import type { NodeBlobStore } from "../adapters/node-blob-store";
import type { NodeConflictDecisionStore } from "../adapters/node-conflict-decision-store";
import type { NodeFileHasher } from "../adapters/node-file-hasher";
import type { NodeHistoryRepository } from "../adapters/node-history-repository";
import type { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import type { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import type { VaultEventApplier } from "../adapters/vault-event-applier";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { withRetry } from "../application/with-retry";
import { sleep } from "../infra/sleep";
import type { ConflictResolutionStrategy } from "../ports/conflict-decision-store";
import type { FileHash } from "../ports/file-hasher";
import type { SyncProvider } from "../ports/sync-provider";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";
import { resolveKeepLocal } from "./keep-local";
import { resolveKeepRemote } from "./keep-remote";
import type { SnapshotService } from "./snapshot-service";
import { compareAllStates } from "./sync-diff";

/**
 * Tipos de conflito retornados pelo serviço de sincronização.
 */
export type ConflictType =
	| "both_modified"
	| "local_deleted_remote_modified"
	| "remote_deleted_local_modified";

/**
 * Representa um conflito simplificado identificado durante a sincronização.
 */
export type Conflict = {
	/**
	 * Caminho relativo do arquivo em conflito.
	 */
	path: string;

	/**
	 * Tipo de conflito detectado.
	 */
	type: ConflictType;
};

const retryPolicy = defaultNetworkRetryPolicy();

/**
 * Normaliza diferentes formatos possíveis de hash para string.
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
 * Reconcila o campo `lastSyncedHash` com base nos hashes local e remoto.
 *
 * Quando os hashes local e remoto são iguais, o arquivo passa a ser tratado
 * como sincronizado.
 *
 * @param state Estado parcial do arquivo.
 */
function reconcileSynced(state: Partial<FileSyncState>): void {
	const localHash = normalizeHash(
		(state as Partial<FileSyncState> & { lastLocalHash?: unknown })
			.lastLocalHash,
	);
	const remoteHash = normalizeHash(
		(state as Partial<FileSyncState> & { lastRemoteHash?: unknown })
			.lastRemoteHash,
	);

	if (localHash && remoteHash && localHash === remoteHash) {
		(
			state as Partial<FileSyncState> & { lastSyncedHash?: unknown }
		).lastSyncedHash = (
			state as Partial<FileSyncState> & { lastLocalHash?: unknown }
		).lastLocalHash;
		return;
	}

	if (!localHash && !remoteHash) {
		(
			state as Partial<FileSyncState> & { lastSyncedHash?: undefined }
		).lastSyncedHash = undefined;
	}
}

/**
 * Obtém o hash associado a um evento de histórico.
 *
 * @param event Evento de histórico.
 * @returns Hash do evento ou `undefined`.
 */
function pickHashFromEvent(event: HistoryEvent): FileHash | undefined {
	return event?.change?.hash;
}

/**
 * Verifica se um evento representa exclusão.
 *
 * @param event Evento de histórico.
 * @returns `true` quando o evento for de deleção.
 */
function isDeletedEvent(event: HistoryEvent): boolean {
	return event?.change?.changeType === "deleted";
}

/**
 * Constrói um mapa contendo apenas o evento mais recente de cada path.
 *
 * @param events Lista de eventos.
 * @returns Mapa indexado por path.
 */
function buildLatestByPath(events: HistoryEvent[]): Map<string, HistoryEvent> {
	const sorted = [...events].sort((a, b) => {
		const aa = new Date(a.occurredAtIso).getTime();
		const bb = new Date(b.occurredAtIso).getTime();
		return aa - bb;
	});

	const map = new Map<string, HistoryEvent>();

	for (const event of sorted) {
		map.set(event.change.path, event);
	}

	return map;
}

/**
 * Lê eventos armazenados em um arquivo `.jsonl`.
 *
 * Linhas inválidas são ignoradas.
 *
 * @param filePath Caminho do arquivo de histórico.
 * @returns Eventos válidos encontrados.
 */
async function readJsonlEvents(filePath: string): Promise<HistoryEvent[]> {
	const out: HistoryEvent[] = [];
	const content = await fs.readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim().length > 0);

	for (const line of lines) {
		try {
			out.push(JSON.parse(line) as HistoryEvent);
		} catch {}
	}

	return out;
}

/**
 * Lê todos os eventos do histórico local do vault.
 *
 * @param vaultAbs Caminho absoluto do vault.
 * @returns Lista completa de eventos locais.
 */
async function readAllLocalHistory(vaultAbs: string): Promise<HistoryEvent[]> {
	const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");

	let files: string[] = [];

	try {
		files = (await fs.readdir(localHistoryDir))
			.filter((file) => file.endsWith(".jsonl"))
			.sort();
	} catch {
		files = [];
	}

	const all: HistoryEvent[] = [];

	for (const file of files) {
		const filePath = path.join(localHistoryDir, file);
		const events = await readJsonlEvents(filePath);
		all.push(...events);
	}

	return all;
}

/**
 * Resumo consolidado da execução de uma sincronização.
 */
export type SyncRunSummary = {
	/**
	 * Quantidade de eventos remotos aplicados localmente.
	 */
	pulledApplied: number;

	/**
	 * Quantidade de eventos locais enviados ao remoto.
	 */
	pushed: number;

	/**
	 * Quantidade de conflitos detectados antes da resolução.
	 */
	conflictsBefore: number;

	/**
	 * Quantidade de conflitos restantes ao final da execução.
	 */
	conflictsAfter: number;

	/**
	 * Cursor utilizado antes do pull.
	 */
	cursorBefore: string | null;

	/**
	 * Cursor salvo ao final da execução.
	 */
	cursorAfter: string | null;

	/**
	 * Paths bloqueados de push por ainda estarem em conflito.
	 */
	blockedConflictPaths: string[];
};

/**
 * Serviço responsável por executar o ciclo completo de sincronização.
 */
export class SyncService {
	constructor(
		private readonly deps: {
			provider: SyncProvider;
			cursorStore: NodeRemoteCursorStore;
			applier: VaultEventApplier;
			hasher: NodeFileHasher;
			stateStore: NodeSyncStateStore;
			historyRepository: NodeHistoryRepository;
			decisionStore: NodeConflictDecisionStore;
			blobStore: NodeBlobStore;
			snapshotService: SnapshotService;
		},
	) {}

	/**
	 * Executa uma rodada completa de sincronização do vault.
	 *
	 * @param params Parâmetros da sincronização.
	 * @returns Resumo da execução.
	 */
	async syncOnce(params: {
		/**
		 * Caminho absoluto da raiz do vault.
		 */
		vaultRootAbs: string;

		/**
		 * Estratégia padrão para resolução de conflitos.
		 */
		defaultConflictStrategy: ConflictResolutionStrategy;
	}): Promise<SyncRunSummary> {
		const { vaultRootAbs, defaultConflictStrategy } = params;

		const {
			provider,
			cursorStore,
			applier,
			hasher,
			stateStore,
			historyRepository,
			decisionStore,
			blobStore,
			snapshotService,
		} = this.deps;

		const vaultId = path.basename(vaultRootAbs);
		const nowIso = () => new Date().toISOString();

		/**
		 * Atualiza parcialmente o estado de sincronização de um arquivo.
		 *
		 * Quando `lastSyncedHash` não é informado explicitamente, ele é recalculado
		 * a partir dos hashes local e remoto.
		 *
		 * @param patch Patch parcial contendo os campos a atualizar.
		 */
		async function upsertStatePatch(
			patch: Partial<FileSyncState> & { path: string },
		): Promise<void> {
			const prev = await stateStore.get(vaultRootAbs, patch.path);

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

			await stateStore.upsert(vaultRootAbs, merged);
		}

		/**
		 * Verifica se o vault parece vazio para fins de bootstrap.
		 *
		 * @returns `true` quando não há conteúdo relevante além de diretórios internos.
		 */
		async function isVaultProbablyEmpty(): Promise<boolean> {
			try {
				const entries = await fs.readdir(vaultRootAbs, { withFileTypes: true });
				const meaningful = entries.filter(
					(entry) => entry.name !== ".obsidian" && entry.name !== ".mini-sync",
				);
				return meaningful.length === 0;
			} catch {
				return false;
			}
		}

		/**
		 * Restaura o conteúdo local a partir de um manifesto de snapshot remoto.
		 *
		 * @param manifest Manifesto do snapshot a restaurar.
		 */
		async function restoreFromSnapshotManifest(
			manifest: SnapshotManifest,
		): Promise<void> {
			for (const file of manifest.files) {
				const abs = path.join(vaultRootAbs, file.path);
				await fs.mkdir(path.dirname(abs), { recursive: true });

				if (file.inlineTextUtf8 !== undefined) {
					await fs.writeFile(abs, file.inlineTextUtf8, "utf-8");
					continue;
				}

				const sha = file.blobSha256 ?? file.sha256;

				if (!(await blobStore.has(vaultRootAbs, sha))) {
					const remoteHas = await withRetry(
						() => provider.hasBlob({ sha256: sha }),
						retryPolicy,
						sleep,
					);

					if (remoteHas) {
						const data = await withRetry(
							() => provider.getBlob({ sha256: sha }),
							retryPolicy,
							sleep,
						);

						await blobStore.put(vaultRootAbs, sha, data);
					}
				}

				const data = await blobStore.get(vaultRootAbs, sha);
				await fs.writeFile(abs, data);
			}
		}

		if (await isVaultProbablyEmpty()) {
			const snapshots = await withRetry(
				() => provider.listSnapshots(),
				retryPolicy,
				sleep,
			);

			if (snapshots.length > 0) {
				const latest = snapshots.at(-1);

				if (latest) {
					const manifest = await withRetry(
						() => provider.getSnapshotManifest(latest),
						retryPolicy,
						sleep,
					);

					await restoreFromSnapshotManifest(manifest);
				}
			}
		}

		await historyRepository.ensureStructure(vaultRootAbs);

		const allLocalEvents = await readAllLocalHistory(vaultRootAbs);
		const latestLocalByPath = buildLatestByPath(allLocalEvents);

		for (const [eventPath, event] of latestLocalByPath.entries()) {
			if (isDeletedEvent(event)) {
				await upsertStatePatch({
					path: eventPath,
					lastLocalHash: undefined,
				});
			} else {
				const hash = pickHashFromEvent(event);
				if (hash) {
					await upsertStatePatch({
						path: eventPath,
						lastLocalHash: hash,
					});
				}
			}
		}

		const cursor = await cursorStore.load(vaultRootAbs);
		const cursorBefore = cursor?.value ?? null;

		const pullRes = await withRetry(
			() => provider.pullHistoryEvents(cursor),
			retryPolicy,
			sleep,
		);

		const pulled = pullRes.events;
		const nextCursor = pullRes.nextCursor;

		const latestRemoteByPath = buildLatestByPath(pulled);

		for (const [eventPath, event] of latestRemoteByPath.entries()) {
			if (isDeletedEvent(event)) {
				await upsertStatePatch({
					path: eventPath,
					lastRemoteHash: undefined,
				});
			} else {
				const hash = pickHashFromEvent(event);
				if (hash) {
					await upsertStatePatch({
						path: eventPath,
						lastRemoteHash: hash,
					});
				}
			}
		}

		const allStatesBefore = await stateStore.loadAll(vaultRootAbs);
		const { conflicts: conflictsBefore } = compareAllStates(allStatesBefore);

		const remoteAllNow = await withRetry(
			() => provider.pullHistoryEvents(null),
			retryPolicy,
			sleep,
		);

		if (conflictsBefore.length > 0) {
			for (const conflict of conflictsBefore) {
				const relativePath = conflict.path.replaceAll("\\", "/");

				const saved = await decisionStore.get(vaultRootAbs, relativePath);
				const chosen: ConflictResolutionStrategy =
					saved?.strategy ?? defaultConflictStrategy;

				await decisionStore.set(vaultRootAbs, {
					path: relativePath,
					strategy: chosen,
					decidedAtIso: new Date().toISOString(),
				});

				if (chosen === "local") {
					await resolveKeepLocal({
						vaultRootAbs,
						conflicts: [conflict],
						hasher,
						provider,
						historyRepository,
						stateStore,
					});
				} else {
					await resolveKeepRemote({
						vaultRootAbs,
						conflicts: [conflict],
						pulledRemoteEvents: remoteAllNow.events,
						hasher,
						historyRepository,
						stateStore,
					});
				}
			}
		}

		const statesAfterResolution = await stateStore.loadAll(vaultRootAbs);
		const { conflicts: conflictsAfterResolution } = compareAllStates(
			statesAfterResolution,
		);

		const conflictPaths = new Set(
			conflictsAfterResolution.map((conflict) => conflict.path),
		);

		const toApply = pulled.filter(
			(event) => !conflictPaths.has(event.change.path),
		);

		for (const event of toApply) {
			const sha = event.blob?.sha256;
			if (!sha) continue;
			if (await blobStore.has(vaultRootAbs, sha)) continue;

			const data = await withRetry(
				() => provider.getBlob({ sha256: sha }),
				retryPolicy,
				sleep,
			);

			await blobStore.put(vaultRootAbs, sha, data);
		}

		if (toApply.length > 0) {
			await setApplyLock(vaultRootAbs);

			try {
				await applier.apply(vaultRootAbs, toApply);
			} finally {
				await clearApplyLock(vaultRootAbs);
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

		await cursorStore.save(vaultRootAbs, nextCursor ?? cursor);
		const cursorAfter = (nextCursor ?? cursor)?.value ?? null;

		const finalStatesBeforePush = await stateStore.loadAll(vaultRootAbs);
		const { conflicts: finalConflictsBeforePush } = compareAllStates(
			finalStatesBeforePush,
		);

		const blockedPaths = new Set(
			finalConflictsBeforePush.map((conflict) => conflict.path),
		);

		const remoteAllBeforePush = await withRetry(
			() => provider.pullHistoryEvents(null),
			retryPolicy,
			sleep,
		);

		const remoteIds = new Set(
			remoteAllBeforePush.events.map((event) => event.id),
		);

		const signature = (event: HistoryEvent) =>
			`${event.change.path}|${event.change.changeType}|${normalizeHash(
				event.change.hash,
			)}|${event.occurredAtIso}`;

		const remoteSigs = new Set(remoteAllBeforePush.events.map(signature));

		const toPush = allLocalEvents.filter(
			(event) =>
				!blockedPaths.has(event.change.path) &&
				!remoteIds.has(event.id) &&
				!remoteSigs.has(signature(event)),
		);

		for (const event of toPush) {
			const sha = event.blob?.sha256;
			if (!sha) continue;

			const existsRemote = await withRetry(
				() => provider.hasBlob({ sha256: sha }),
				retryPolicy,
				sleep,
			);

			if (existsRemote) continue;

			if (!(await blobStore.has(vaultRootAbs, sha))) {
				const abs = path.join(
					vaultRootAbs,
					event.change.path.replaceAll("\\", "/"),
				);
				const buffer = await fs.readFile(abs);
				await blobStore.put(vaultRootAbs, sha, buffer);
			}

			const buffer = await blobStore.get(vaultRootAbs, sha);
			await withRetry(
				() => provider.putBlob({ sha256: sha }, buffer),
				retryPolicy,
				sleep,
			);
		}

		await withRetry(
			() => provider.pushHistoryEvents(toPush),
			retryPolicy,
			sleep,
		);

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

		if (toPush.length > 0) {
			const manifest = await snapshotService.createSnapshotManifest({
				vaultRootAbs,
				vaultId,
			});

			for (const file of manifest.files) {
				const sha = file.blobSha256;
				if (!sha) continue;

				const existsRemote = await withRetry(
					() => provider.hasBlob({ sha256: sha }),
					retryPolicy,
					sleep,
				);

				if (existsRemote) continue;

				if (!(await blobStore.has(vaultRootAbs, sha))) {
					const abs = path.join(vaultRootAbs, file.path);
					const buffer = await fs.readFile(abs);
					await blobStore.put(vaultRootAbs, sha, buffer);
				}

				const buffer = await blobStore.get(vaultRootAbs, sha);
				await withRetry(
					() => provider.putBlob({ sha256: sha }, buffer),
					retryPolicy,
					sleep,
				);
			}

			await withRetry(
				() => provider.putSnapshotManifest({ id: manifest.id }, manifest),
				retryPolicy,
				sleep,
			);
		}

		const allStatesAfter = await stateStore.loadAll(vaultRootAbs);
		const { conflicts: conflictsAfter } = compareAllStates(allStatesAfter);

		return {
			pulledApplied: toApply.length,
			pushed: toPush.length,
			conflictsBefore: conflictsBefore.length,
			conflictsAfter: conflictsAfter.length,
			cursorBefore,
			cursorAfter,
			blockedConflictPaths: [...blockedPaths],
		};
	}
}