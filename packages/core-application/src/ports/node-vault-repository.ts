import fs from "node:fs/promises";
import { createReadStream, type Dirent } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";


import type { VaultRepository } from "../ports/vault-repository";
import type { Snapshot } from "@mini-sync/core-domain";
import type { ChangeSet } from "@mini-sync/core-domain";
import type { FileRecord } from "@mini-sync/core-domain";

/**
 * Node implementation of the VaultRepository port.  This adapter treats the
 * provided `vaultId` as the absolute path to the vault on disk.  It is
 * responsible for generating snapshots by walking the directory tree and
 * computing file hashes, sizes and modification times.  It also provides a
 * stubbed `applyChangeSet` implementation which handles deletions but does
 * not yet restore file contents for added/modified records (this will be
 * addressed in later epics when snapshot transport is implemented).
 */
export class NodeVaultRepository implements VaultRepository {
  /**
   * Recursively walk a directory and return an array of absolute file paths.
   * Files and directories related to Obsidian internals (such as `.obsidian`
   * and `.mini-sync`) are ignored.  Hidden files not starting with a dot are
   * still included.
   */
  private async collectFiles(root: string, current: string = ""): Promise<string[]> {
    const dir = path.join(root, current);
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
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
   * Compute a SHA‑256 hash of a file and return as a hex string.  A small
   * helper is defined here instead of depending on the FileHasher port to
   * avoid a circular dependency between adapters.
   */
  private async hashFile(abs: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = createReadStream(abs);
      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      stream.on("error", (err) => reject(err));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async generateSnapshot(vaultId: string): Promise<Snapshot> {
    const vaultRoot = path.resolve(vaultId);
    // collect relative file paths
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
      vaultId: vaultId as any,
      createdAtMs: Date.now(),
      files: records,
    };
    return snapshot;
  }

  async applyChangeSet(vaultId: string, changeSet: ChangeSet): Promise<void> {
    const vaultRoot = path.resolve(vaultId);
    // handle deletions first
    for (const del of changeSet.deleted) {
      const abs = path.join(vaultRoot, del.path);
      try {
        await fs.rm(abs, { force: true });
      } catch {
        // ignore
      }
    }
    // For added/modified records we currently do not restore contents from
    // snapshots because the current MVP uses history events carrying the
    // contents.  In a future epic this method will be extended to pull file
    // contents from a remote transport or snapshot store.  For now, create
    // empty placeholder files to avoid breaking the file tree.
    const handle = async (record: FileRecord) => {
      const abs = path.join(vaultRoot, record.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      try {
        await fs.writeFile(abs, "");
      } catch {
        // ignore inability to write
      }
    };
    for (const rec of changeSet.added) {
      await handle(rec);
    }
    for (const rec of changeSet.modified) {
      await handle(rec);
    }
  }
}