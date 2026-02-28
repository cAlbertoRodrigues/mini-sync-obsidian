import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryEvent } from "../value-objects/history-event";
import { NodeBlobStore } from "./node-blob-store";

export class VaultEventApplier {
  private blobStore = new NodeBlobStore();

  async apply(vaultRootAbs: string, events: HistoryEvent[]): Promise<void> {
    for (const ev of events) {
      const rel = ev.change.path.replaceAll("\\", "/");
      const abs = path.join(vaultRootAbs, rel);

      if (ev.change.changeType === "deleted") {
        await fs.rm(abs, { force: true });
        continue;
      }

      await fs.mkdir(path.dirname(abs), { recursive: true });

      // 1) texto inline
      if (ev.contentUtf8 !== undefined) {
        await fs.writeFile(abs, ev.contentUtf8, "utf-8");
        continue;
      }

      // 2) blob
      if (ev.blob?.sha256) {
        const data = await this.blobStore.get(vaultRootAbs, ev.blob.sha256);
        await fs.writeFile(abs, data);
        continue;
      }

      // 3) sem conteúdo => não aplica (SyncService deve garantir fetch antes)
      continue;
    }
  }
}