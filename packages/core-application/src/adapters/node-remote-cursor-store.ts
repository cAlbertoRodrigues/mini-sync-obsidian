import path from "node:path";
import fs from "node:fs/promises";

import type { SyncCursor } from "../ports/sync-provider";

type CursorFilePayload = {
  value: string | null;
};

function sanitizeNamespace(ns: string) {
  // arquivo seguro no Windows
  return ns.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export class NodeRemoteCursorStore {
  /**
   * Namespace opcional para evitar colisão entre:
   * - providers diferentes (drive/local/github)
   * - vaultId diferentes (vaultA vs shared-vault)
   *
   * Ex: "drive.shared-vault"
   */
  constructor(private readonly namespace?: string) {}

  private stateDir(vaultAbs: string) {
    return path.join(vaultAbs, ".mini-sync", "state");
  }

  private legacyCursorPath(vaultAbs: string) {
    return path.join(this.stateDir(vaultAbs), "remote-cursor.json");
  }

  private namespacedCursorPath(vaultAbs: string) {
    if (!this.namespace) return this.legacyCursorPath(vaultAbs);
    const safe = sanitizeNamespace(this.namespace);
    return path.join(this.stateDir(vaultAbs), `remote-cursor.${safe}.json`);
  }

  async load(vaultAbs: string): Promise<SyncCursor | null> {
    const stateDir = this.stateDir(vaultAbs);
    await fs.mkdir(stateDir, { recursive: true });

    const nsPath = this.namespacedCursorPath(vaultAbs);
    const legacyPath = this.legacyCursorPath(vaultAbs);

    // 1) tenta namespaced
    if (await exists(nsPath)) {
      const raw = await fs.readFile(nsPath, "utf-8");
      try {
        const parsed = JSON.parse(raw) as CursorFilePayload;
        return parsed?.value ? { value: String(parsed.value) } : null;
      } catch {
        return null;
      }
    }

    // 2) fallback: legado (pra não quebrar usuários atuais)
    if (await exists(legacyPath)) {
      const raw = await fs.readFile(legacyPath, "utf-8");
      try {
        const parsed = JSON.parse(raw) as CursorFilePayload;
        return parsed?.value ? { value: String(parsed.value) } : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  async save(vaultAbs: string, cursor: SyncCursor | null): Promise<void> {
    const stateDir = this.stateDir(vaultAbs);
    await fs.mkdir(stateDir, { recursive: true });

    const filePath = this.namespacedCursorPath(vaultAbs);

    const payload: CursorFilePayload = {
      value: cursor?.value ?? null,
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  }
}
