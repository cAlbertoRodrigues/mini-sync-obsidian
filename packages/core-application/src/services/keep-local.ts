import fs from "node:fs/promises";
import path from "node:path";

import type { Conflict, ConflictType } from "@mini-sync/core-domain";

import type { SyncProvider } from "../ports/sync-provider";
import type { FileHasher, FileHash } from "../ports/file-hasher";
import type { HistoryRepository } from "../ports/history-repository";

import type { FileMetadata } from "../value-objects/file-metadata";
import { createHistoryEvent } from "../value-objects/history-event";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";

/**
 * Estratégia "manter local" (MVP):
 * - Para conflitos modified_modified:
 *   - lê o arquivo local (md)
 *   - gera um HistoryEvent com o conteúdo local (contentUtf8)
 *   - faz push pro remoto
 *   - atualiza o FileSyncState: lastSyncedHash e lastRemoteHash = lastLocalHash
 */
export async function resolveKeepLocal(params: {
  vaultRootAbs: string;
  conflicts: Conflict[];
  hasher: FileHasher;
  provider: SyncProvider;
  historyRepository: HistoryRepository;
  stateStore: NodeSyncStateStore;
}): Promise<void> {
  const { vaultRootAbs, conflicts, hasher, provider, historyRepository, stateStore } = params;

  if (conflicts.length === 0) return;

  await historyRepository.ensureStructure(vaultRootAbs);

  for (const c of conflicts) {
    if (c.type !== ("modified_modified" as ConflictType)) continue;

    const rel = c.path.replaceAll("\\", "/");
    const abs = path.join(vaultRootAbs, rel);

    // Conteúdo só para markdown, alinhado com o seu applier
    let contentUtf8: string | undefined;
    try {
      if (rel.toLowerCase().endsWith(".md")) {
        contentUtf8 = await fs.readFile(abs, "utf-8");
      } else {
        // por enquanto só suportamos md
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

    // ✅ modelo novo
    event.contentUtf8 = contentUtf8;

    // registra no histórico local
    await historyRepository.append(vaultRootAbs, event);

    // impõe o conteúdo local no remoto
    await provider.pushHistoryEvents([event]);

    // atualiza sync state
    await stateStore.upsert(vaultRootAbs, {
      path: rel,
      lastLocalHash: localHash,
      lastRemoteHash: localHash,
      lastSyncedHash: localHash,
      updatedAtIso: new Date().toISOString(),
    });
  }
}