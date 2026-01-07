import fs from "fs/promises";
import path from "path";
import type { FileSyncState } from "../value-objects/file-sync-state";

type StateFile = {
  files: Record<string, FileSyncState>;
};

export class NodeSyncStateStore {
  private filePath(vaultRoot: string) {
    return path.join(vaultRoot, ".mini-sync", "state", "file-sync-state.json");
  }

  async loadAll(vaultRoot: string): Promise<Record<string, FileSyncState>> {
    const fp = this.filePath(vaultRoot);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const parsed = JSON.parse(raw) as StateFile;
      return parsed.files ?? {};
    } catch {
      return {};
    }
  }

  async saveAll(vaultRoot: string, files: Record<string, FileSyncState>): Promise<void> {
    const fp = this.filePath(vaultRoot);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify({ files }, null, 2), "utf-8");
  }

  async get(vaultRoot: string, filePathKey: string): Promise<FileSyncState | null> {
    const all = await this.loadAll(vaultRoot);
    return all[filePathKey] ?? null;
  }

  async upsert(vaultRoot: string, state: FileSyncState): Promise<void> {
    const all = await this.loadAll(vaultRoot);
    all[state.path] = state;
    await this.saveAll(vaultRoot, all);
  }

  async remove(vaultRoot: string, filePathKey: string): Promise<void> {
    const all = await this.loadAll(vaultRoot);
    delete all[filePathKey];
    await this.saveAll(vaultRoot, all);
  }
}
