import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { VaultRepository } from "../ports/vault-repository";
import type { Snapshot, ChangeSet, FileRecord, VaultId } from "@mini-sync/core-domain";

export class NodeVaultRepository implements VaultRepository {
  private async collectFiles(root: string, current: string = ""): Promise<string[]> {
    const dir = path.join(root, current);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];

    for (const entry of entries) {
      const rel = path.join(current, entry.name);

      // ignore internal directories of Obsidian and mini-sync metadata
      if (rel.startsWith(`.obsidian${path.sep}`) || rel === ".obsidian") continue;
      if (rel.startsWith(`.mini-sync${path.sep}`) || rel === ".mini-sync") continue;
      if (rel.startsWith(`.trash${path.sep}`) || rel === ".trash") continue;

      // skip macOS metadata
      if (entry.name === ".DS_Store") continue;

      if (entry.isDirectory()) {
        const nested = await this.collectFiles(root, rel);
        files.push(...nested);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }

    return files;
  }

  /**
   * Compute a SHA-256 hash of a file and return as a hex string.
   */
  private async hashFile(abs: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = createReadStream(abs);

      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async generateSnapshot(vaultId: VaultId): Promise<Snapshot> {
    const vaultRoot = path.resolve(String(vaultId));

    const relativeFiles = await this.collectFiles(vaultRoot);
    const records: FileRecord[] = [];

    for (const rel of relativeFiles) {
      const abs = path.join(vaultRoot, rel);

      try {
        const stat = await fs.stat(abs);
        const hash = await this.hashFile(abs);

        records.push({
          path: rel.replace(/\\/g, "/"),
          hash,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // ignore files that cannot be read
      }
    }

    const id = crypto.randomUUID();

    const snapshot: Snapshot = {
      id,
      vaultId,
      createdAtMs: Date.now(),
      files: records,
    };

    return snapshot;
  }

  async applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void> {
    const vaultRoot = path.resolve(String(vaultId));

    // deletions first
    for (const del of changeSet.deleted) {
      const abs = path.join(vaultRoot, del.path);
      try {
        await fs.rm(abs, { force: true });
      } catch {
        // ignore
      }
    }

    // placeholder write for added/modified (future: restore actual content)
    const handle = async (record: FileRecord) => {
      const abs = path.join(vaultRoot, record.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      try {
        await fs.writeFile(abs, "");
      } catch {
        // ignore inability to write
      }
    };

    for (const rec of changeSet.added) await handle(rec);
    for (const rec of changeSet.modified) await handle(rec);
  }
}
