import fs from "node:fs/promises";
import path from "node:path";
import { setApplyLock, clearApplyLock } from "../adapters/apply-lock";
/**
 * Estratégia "manter remoto" (MVP):
 * - Para cada conflito modified_modified:
 *   - encontra o último HistoryEvent remoto daquele path (dentro do batch do pull)
 *   - aplica o conteúdo remoto no arquivo local (com apply-lock, para não gerar evento local)
 *   - recalcula hash local
 *   - atualiza FileSyncState: lastLocalHash = lastRemoteHash = lastSyncedHash (convergência)
 *   - (opcional) registra um evento local indicando a decisão (DESLIGADO no MVP)
 */
export async function resolveKeepRemote(params) {
    const { vaultRootAbs, conflicts, pulledRemoteEvents, hasher, historyRepository, stateStore, } = params;
    if (conflicts.length === 0)
        return;
    // index: último evento por path (do batch do pull atual)
    const lastRemoteByPath = new Map();
    for (const ev of pulledRemoteEvents) {
        const p = ev.change.path.replaceAll("\\", "/");
        lastRemoteByPath.set(p, ev);
    }
    await historyRepository.ensureStructure(vaultRootAbs);
    for (const c of conflicts) {
        if (c.type !== "modified_modified")
            continue;
        const rel = c.path.replaceAll("\\", "/");
        const remoteEvent = lastRemoteByPath.get(rel);
        // Sem evento remoto no batch => não tem como aplicar "manter remoto" agora
        if (!remoteEvent)
            continue;
        // Só suportamos eventos com conteúdo (md utf-8 no MVP)
        if (!remoteEvent.content || remoteEvent.encoding !== "utf-8")
            continue;
        const abs = path.join(vaultRootAbs, rel);
        // 1) Aplica conteúdo remoto no arquivo local COM LOCK (para o watcher ignorar)
        await setApplyLock(vaultRootAbs);
        try {
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, remoteEvent.content, "utf-8");
        }
        finally {
            await clearApplyLock(vaultRootAbs);
        }
        // 2) Recalcula hash local após escrita (fonte da verdade do que foi aplicado)
        const appliedHash = await hasher.hashFile(abs);
        // 3) Convergência total do estado: local/remoto/synced viram o mesmo hash
        await stateStore.upsert(vaultRootAbs, {
            path: rel,
            lastLocalHash: appliedHash,
            lastRemoteHash: appliedHash,
            lastSyncedHash: appliedHash,
            updatedAtIso: new Date().toISOString(),
        });
        // 4) (opcional) Registrar evento local refletindo decisão
        //    ⚠️ DESLIGADO no MVP para evitar duplicar histórico e reabrir conflito via watcher.
        // const meta: FileMetadata = {
        //   path: rel,
        //   absolutePath: abs,
        //   changeType: "modified",
        //   occurredAt: new Date(),
        //   hash: appliedHash,
        // };
        //
        // const decisionEvent = createHistoryEvent(meta, "local");
        // decisionEvent.content = remoteEvent.content;
        // decisionEvent.encoding = "utf-8";
        //
        // await historyRepository.append(vaultRootAbs, decisionEvent);
    }
}
