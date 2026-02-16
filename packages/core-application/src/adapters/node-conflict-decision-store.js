import fs from "node:fs/promises";
import path from "node:path";
export class NodeConflictDecisionStore {
    decisionsFile(vaultRootAbs) {
        return path.join(vaultRootAbs, ".mini-sync", "conflicts", "decisions.json");
    }
    async load(vaultRootAbs) {
        const file = this.decisionsFile(vaultRootAbs);
        try {
            const raw = await fs.readFile(file, "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return { decisions: [] };
        }
    }
    async save(vaultRootAbs, data) {
        const dir = path.dirname(this.decisionsFile(vaultRootAbs));
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.decisionsFile(vaultRootAbs), JSON.stringify(data, null, 2), "utf-8");
    }
    async get(vaultRootAbs, pathRel) {
        const data = await this.load(vaultRootAbs);
        return data.decisions.find((d) => d.path === pathRel) ?? null;
    }
    async set(vaultRootAbs, decision) {
        const data = await this.load(vaultRootAbs);
        const filtered = data.decisions.filter((d) => d.path !== decision.path);
        filtered.push(decision);
        await this.save(vaultRootAbs, { decisions: filtered });
    }
    async remove(vaultRootAbs, pathRel) {
        const data = await this.load(vaultRootAbs);
        const filtered = data.decisions.filter((d) => d.path !== pathRel);
        await this.save(vaultRootAbs, { decisions: filtered });
    }
    async list(vaultRootAbs) {
        const data = await this.load(vaultRootAbs);
        return data.decisions;
    }
}
