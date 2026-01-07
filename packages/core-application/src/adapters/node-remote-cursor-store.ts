import fs from "fs/promises";
import path from "path";
import type { SyncCursor } from "../ports/sync-provider";

type CursorState = {
  cursor: string | null;
};

export class NodeRemoteCursorStore {
  private filePath(vaultRoot: string) {
    return path.join(vaultRoot, ".mini-sync", "state", "remote-cursor.json");
  }

  async load(vaultRoot: string): Promise<SyncCursor | null> {
    const fp = this.filePath(vaultRoot);
    try {
      const content = await fs.readFile(fp, "utf-8");
      const data = JSON.parse(content) as CursorState;
      return data.cursor ? { value: data.cursor } : null;
    } catch {
      return null;
    }
  }

  async save(vaultRoot: string, cursor: SyncCursor | null): Promise<void> {
    const fp = this.filePath(vaultRoot);
    await fs.mkdir(path.dirname(fp), { recursive: true });

    const data: CursorState = { cursor: cursor?.value ?? null };
    await fs.writeFile(fp, JSON.stringify(data, null, 2), "utf-8");
  }
}
