import fs from "node:fs/promises";
import path from "node:path";

import type { Conflict, ConflictType } from "@mini-sync/core-domain";
import type { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import type { FileHash, FileHasher } from "../ports/file-hasher";
import type { HistoryRepository } from "../ports/history-repository";
import type { SyncProvider } from "../ports/sync-provider";
import type { FileMetadata } from "../value-objects/file-metadata";
import { createHistoryEvent } from "../value-objects/history-event";

/**
 * Resolve conflitos utilizando a estratégia "manter local".
 *
 * Para conflitos do tipo `modified_modified`, o conteúdo local é considerado
 * a fonte de verdade. O processo:
 * - lê o conteúdo local do arquivo
 * - gera um novo `HistoryEvent` representando a alteração local
 * - envia o evento para o provedor remoto
 * - atualiza o estado de sincronização para refletir o novo hash sincronizado
 *
 * Atualmente a estratégia suporta apenas arquivos `.md`.
 *
 * @param params Parâmetros necessários para executar a resolução.
 */
export async function resolveKeepLocal(params: {
	/**
	 * Caminho absoluto da raiz do vault.
	 */
	vaultRootAbs: string;

	/**
	 * Lista de conflitos detectados.
	 */
	conflicts: Conflict[];

	/**
	 * Serviço responsável por calcular hashes de arquivos.
	 */
	hasher: FileHasher;

	/**
	 * Provedor de sincronização remoto.
	 */
	provider: SyncProvider;

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
		hasher,
		provider,
		historyRepository,
		stateStore,
	} = params;

	if (conflicts.length === 0) return;

	await historyRepository.ensureStructure(vaultRootAbs);

	for (const conflict of conflicts) {
		if (conflict.type !== ("modified_modified" as ConflictType)) continue;

		const rel = conflict.path.replaceAll("\\", "/");
		const abs = path.join(vaultRootAbs, rel);

		let contentUtf8: string | undefined;

		try {
			if (rel.toLowerCase().endsWith(".md")) {
				contentUtf8 = await fs.readFile(abs, "utf-8");
			} else {
				continue;
			}
		} catch {
			continue;
		}

		const localHash: FileHash = await hasher.hashFile(abs);

		const meta: FileMetadata = {
			path: rel,
			absolutePath: abs,
			changeType: "modified",
			occurredAt: new Date(),
			hash: localHash,
		};

		const event = createHistoryEvent(meta, "local");
		event.contentUtf8 = contentUtf8;

		await historyRepository.append(vaultRootAbs, event);

		await provider.pushHistoryEvents([event]);

		await stateStore.upsert(vaultRootAbs, {
			path: rel,
			lastLocalHash: localHash,
			lastRemoteHash: localHash,
			lastSyncedHash: localHash,
			updatedAtIso: new Date().toISOString(),
		});
	}
}
