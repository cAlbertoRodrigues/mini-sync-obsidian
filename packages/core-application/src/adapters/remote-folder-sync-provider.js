import fs from "fs/promises";
import path from "path";
function parseCursor(cursor) {
    if (!cursor)
        return null;
    const [date, lineStr] = cursor.value.split(":");
    const line = Number(lineStr);
    if (!date || Number.isNaN(line))
        return null;
    return { date, line };
}
function makeCursor(date, line) {
    return { value: `${date}:${line}` };
}
function dateFromIso(iso) {
    return iso.slice(0, 10); // YYYY-MM-DD
}
async function exists(p) {
    try {
        await fs.stat(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Remote folder provider (local filesystem acting as remote) that follows the
 * system remote contract:
 *
 * <remoteRoot>/
 *   MiniSync/
 *     <vaultId>/
 *       meta.json
 *       cursor.json
 *       history/
 *         YYYY-MM-DD.jsonl
 *       snapshots/         (reservado para futuro)
 */
export class RemoteFolderSyncProvider {
    remoteRootDir;
    vaultId;
    constructor(remoteRootDir, vaultId) {
        this.remoteRootDir = remoteRootDir;
        this.vaultId = vaultId;
    }
    appRootDir() {
        return path.join(this.remoteRootDir, "MiniSync");
    }
    vaultRootDir() {
        return path.join(this.appRootDir(), this.vaultId);
    }
    historyDir() {
        return path.join(this.vaultRootDir(), "history");
    }
    snapshotsDir() {
        return path.join(this.vaultRootDir(), "snapshots");
    }
    historyFile(date) {
        return path.join(this.historyDir(), `${date}.jsonl`);
    }
    metaFile() {
        return path.join(this.vaultRootDir(), "meta.json");
    }
    cursorFile() {
        return path.join(this.vaultRootDir(), "cursor.json");
    }
    async ensureStructure() {
        await fs.mkdir(this.historyDir(), { recursive: true });
        await fs.mkdir(this.snapshotsDir(), { recursive: true });
        // meta.json (cria se não existir)
        const metaPath = this.metaFile();
        if (!(await exists(metaPath))) {
            const meta = {
                version: 1,
                provider: "remote-folder",
                vaultId: this.vaultId,
                createdAtIso: new Date().toISOString(),
            };
            await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
        }
        // cursor.json (cria se não existir) - útil para debug/inspeção manual
        const cursorPath = this.cursorFile();
        if (!(await exists(cursorPath))) {
            const payload = { value: null };
            await fs.writeFile(cursorPath, JSON.stringify(payload, null, 2), "utf-8");
        }
    }
    async pushHistoryEvents(events) {
        if (events.length === 0)
            return;
        await this.ensureStructure();
        // agrupa por dia para manter 1 arquivo por dia
        const byDate = new Map();
        for (const e of events) {
            const d = dateFromIso(e.occurredAtIso);
            const list = byDate.get(d) ?? [];
            list.push(e);
            byDate.set(d, list);
        }
        for (const [date, list] of byDate.entries()) {
            const filePath = this.historyFile(date);
            const lines = list.map((e) => JSON.stringify(e)).join("\n") + "\n";
            await fs.appendFile(filePath, lines, "utf-8");
        }
    }
    async pullHistoryEvents(cursor) {
        await this.ensureStructure();
        const cur = parseCursor(cursor);
        // lista arquivos YYYY-MM-DD.jsonl em ordem
        const files = (await fs.readdir(this.historyDir()))
            .filter((f) => f.endsWith(".jsonl"))
            .sort(); // ordena por nome => por data
        const events = [];
        let lastDate = null;
        let lastLine = -1;
        for (const file of files) {
            const date = file.replace(".jsonl", "");
            // Se cursor existe, pula tudo antes da data
            if (cur && date < cur.date)
                continue;
            const content = await fs.readFile(path.join(this.historyDir(), file), "utf-8");
            const lines = content.split("\n").filter((l) => l.trim().length > 0);
            const startLine = cur && date === cur.date ? cur.line + 1 : 0;
            for (let i = startLine; i < lines.length; i++) {
                const line = lines[i];
                try {
                    const parsed = JSON.parse(line);
                    events.push(parsed);
                    lastDate = date;
                    lastLine = i;
                }
                catch {
                    // ignora linha inválida
                }
            }
        }
        if (lastDate === null) {
            return { events: [], nextCursor: cursor };
        }
        return { events, nextCursor: makeCursor(lastDate, lastLine) };
    }
}
