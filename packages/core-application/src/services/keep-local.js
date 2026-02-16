import fs from "node:fs/promises";
import path from "node:path";
import { createHistoryEvent } from "../value-objects/history-event";
/**
 * Estratégia "manter local" (MVP):
 * - Para conflitos modified_modified:
 *   - lê o arquivo local (md)
 *   - gera um HistoryEvent com o conteúdo local
 *   - faz push pro remoto
 *   - atualiza o FileSyncState: lastSyncedHash e lastRemoteHash = lastLocalHash
 */
export async function resolveKeepLocal(params) {
    const { vaultRootAbs, conflicts, hasher, provider, historyRepository, stateStore } = params;
    if (conflicts.length === 0)
        return;
    await historyRepository.ensureStructure(vaultRootAbs);
    for (const c of conflicts) {
        if (c.type !== "modified_modified")
            continue;
        const rel = c.path.replaceAll("\\", "/");
        const abs = path.join(vaultRootAbs, rel);
        // Conteúdo só para markdown, alinhado com o seu applier
        let content;
        try {
            if (rel.toLowerCase().endsWith(".md")) {
                content = await fs.readFile(abs, "utf-8");
            }
            else {
                // por enquanto só suportamos md
                continue;
            }
        }
        catch {
            continue;
        }
        const localHash = await hasher.hashFile(abs);
        const meta = {
            path: rel,
            absolutePath: abs,
            changeType: "modified",
            occurredAt: new Date(),
            hash: localHash, // ✅ FileHash (não string)
        };
        const event = createHistoryEvent(meta, "local");
        event.content = content;
        event.encoding = "utf-8";
        // registra no histórico local
        await historyRepository.append(vaultRootAbs, event);
        // impõe o conteúdo local no remoto
        await provider.pushHistoryEvents([event]);
        await stateStore.upsert(vaultRootAbs, {
            path: rel,
            lastLocalHash: localHash, // ✅ sempre o hash local atual
            lastRemoteHash: localHash, // ✅ remoto passa a ser o local
            lastSyncedHash: localHash, // ✅ synced passa a ser o local
            updatedAtIso: new Date().toISOString(),
        });
    }
}
