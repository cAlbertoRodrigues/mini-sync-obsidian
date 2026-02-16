import path from "node:path";
import fs from "node:fs/promises";
function sanitizeNamespace(ns) {
    // arquivo seguro no Windows
    return ns.replace(/[^a-zA-Z0-9._-]/g, "_");
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
export class NodeRemoteCursorStore {
    namespace;
    /**
     * Namespace opcional para evitar colisão entre:
     * - providers diferentes (drive/local/github)
     * - vaultId diferentes (vaultA vs shared-vault)
     *
     * Ex: "drive.shared-vault"
     */
    constructor(namespace) {
        this.namespace = namespace;
    }
    stateDir(vaultAbs) {
        return path.join(vaultAbs, ".mini-sync", "state");
    }
    legacyCursorPath(vaultAbs) {
        return path.join(this.stateDir(vaultAbs), "remote-cursor.json");
    }
    namespacedCursorPath(vaultAbs) {
        if (!this.namespace)
            return this.legacyCursorPath(vaultAbs);
        const safe = sanitizeNamespace(this.namespace);
        return path.join(this.stateDir(vaultAbs), `remote-cursor.${safe}.json`);
    }
    async load(vaultAbs) {
        const stateDir = this.stateDir(vaultAbs);
        await fs.mkdir(stateDir, { recursive: true });
        const nsPath = this.namespacedCursorPath(vaultAbs);
        const legacyPath = this.legacyCursorPath(vaultAbs);
        // 1) tenta namespaced
        if (await exists(nsPath)) {
            const raw = await fs.readFile(nsPath, "utf-8");
            try {
                const parsed = JSON.parse(raw);
                return parsed?.value ? { value: String(parsed.value) } : null;
            }
            catch {
                return null;
            }
        }
        // 2) fallback: legado (pra não quebrar usuários atuais)
        if (await exists(legacyPath)) {
            const raw = await fs.readFile(legacyPath, "utf-8");
            try {
                const parsed = JSON.parse(raw);
                return parsed?.value ? { value: String(parsed.value) } : null;
            }
            catch {
                return null;
            }
        }
        return null;
    }
    async save(vaultAbs, cursor) {
        const stateDir = this.stateDir(vaultAbs);
        await fs.mkdir(stateDir, { recursive: true });
        const filePath = this.namespacedCursorPath(vaultAbs);
        const payload = {
            value: cursor?.value ?? null,
        };
        await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    }
}
