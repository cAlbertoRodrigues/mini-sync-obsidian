import fs from "fs/promises";
import path from "path";
export class NodeSyncStateStore {
    filePath(vaultRoot) {
        return path.join(vaultRoot, ".mini-sync", "state", "file-sync-state.json");
    }
    async loadAll(vaultRoot) {
        const fp = this.filePath(vaultRoot);
        try {
            const raw = await fs.readFile(fp, "utf-8");
            const parsed = JSON.parse(raw);
            return parsed.files ?? {};
        }
        catch {
            return {};
        }
    }
    async saveAll(vaultRoot, files) {
        const fp = this.filePath(vaultRoot);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, JSON.stringify({ files }, null, 2), "utf-8");
    }
    async get(vaultRoot, filePathKey) {
        const all = await this.loadAll(vaultRoot);
        return all[filePathKey] ?? null;
    }
    async upsert(vaultRoot, state) {
        const all = await this.loadAll(vaultRoot);
        all[state.path] = state;
        await this.saveAll(vaultRoot, all);
    }
    async remove(vaultRoot, filePathKey) {
        const all = await this.loadAll(vaultRoot);
        delete all[filePathKey];
        await this.saveAll(vaultRoot, all);
    }
}
