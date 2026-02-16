import fs from "fs/promises";
import path from "path";
export class NodeHistoryRepository {
    getBaseDir(rootDir) {
        return path.join(rootDir, ".mini-sync", "history");
    }
    async ensureStructure(rootDir) {
        const base = this.getBaseDir(rootDir);
        await fs.mkdir(base, { recursive: true });
    }
    async append(rootDir, event) {
        await this.ensureStructure(rootDir);
        const date = event.occurredAtIso.slice(0, 10); // YYYY-MM-DD
        const filePath = path.join(this.getBaseDir(rootDir), `${date}.jsonl`);
        const line = JSON.stringify(event) + "\n";
        await fs.appendFile(filePath, line, "utf-8");
    }
}
