import fs from "node:fs/promises";
import path from "node:path";

import type { Conflict, ConflictType } from "@mini-sync/core-domain";
import { clearApplyLock, setApplyLock } from "../adapters/apply-lock";
import type { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import type { FileHash, FileHasher } from "../ports/file-hasher";
import type { HistoryRepository } from "../ports/history-repository";
import type { HistoryEvent } from "../value-objects/history-event";

/**
 * Resolve conflitos utilizando a estratégia "manter remoto".
 *
 * Para conflitos do tipo `modified_modified`, o conteúdo remoto mais recente
 * do arquivo é aplicado localmente. O processo:
 * - localiza o último evento remoto do path em conflito
 * - aplica o conteúdo remoto no arquivo local sob apply lock
 * - recalcula o hash do conteúdo aplicado
 * - converge o estado de sincronização para o hash resultante
 *
 * Atualmente a estratégia suporta apenas eventos remotos com `contentUtf8`.
 *
 * @param params Parâmetros necessários para executar a resolução.
 */
export async function resolveKeepRemote(params: {
	/**
	 * Caminho absoluto da raiz do vault.
	 */
	vaultRootAbs: string;

	/**
	 * Lista de conflitos detectados.
	 */
	conflicts: Conflict[];

	/**
	 * Eventos remotos recebidos no pull atual.
	 */
	pulledRemoteEvents: HistoryEvent[];

	/**
	 * Serviço responsável por calcular hashes de arquivos.
	 */
	hasher: FileHasher;

	/**
	 * Repositório responsável por persistir eventos de histórico.
	 */
	historyRepository: HistoryRepository;

	/**
	 * Armazenamento de estado de sincronização de arquivos.
	 */
	stateStore: NodeSyncStateStore;
}): Promise<void> {
	const {
		vaultRootAbs,
		conflicts,
		pulledRemoteEvents,
		hasher,
		historyRepository,
		stateStore,
	} = params;

	if (conflicts.length === 0) return;

	const lastRemoteByPath = new Map<string, HistoryEvent>();

	for (const event of pulledRemoteEvents) {
		const eventPath = event.change.path.replaceAll("\\", "/");
		lastRemoteByPath.set(eventPath, event);
	}

	await historyRepository.ensureStructure(vaultRootAbs);

	for (const conflict of conflicts) {
		if (conflict.type !== ("modified_modified" as ConflictType)) continue;

		const rel = conflict.path.replaceAll("\\", "/");
		const remoteEvent = lastRemoteByPath.get(rel);

		if (!remoteEvent) continue;
		if (!remoteEvent.contentUtf8) continue;

		const abs = path.join(vaultRootAbs, rel);

		await setApplyLock(vaultRootAbs);

		try {
			await fs.mkdir(path.dirname(abs), { recursive: true });
			await fs.writeFile(abs, remoteEvent.contentUtf8, "utf-8");
		} finally {
			await clearApplyLock(vaultRootAbs);
		}

		const appliedHash: FileHash = await hasher.hashFile(abs);

		await stateStore.upsert(vaultRootAbs, {
			path: rel,
			lastLocalHash: appliedHash,
			lastRemoteHash: appliedHash,
			lastSyncedHash: appliedHash,
			updatedAtIso: new Date().toISOString(),
		});
	}
}
