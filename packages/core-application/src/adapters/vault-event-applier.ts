import fs from "fs/promises";
import path from "path";
import type { HistoryEvent } from "../value-objects/history-event";

export class VaultEventApplier {
  async apply(vaultRoot: string, events: HistoryEvent[]): Promise<void> {
    for (const ev of events) {
      const rel = ev.change.path.replaceAll("\\", "/");
      const abs = path.join(vaultRoot, rel);

      if (ev.change.changeType === "deleted") {
        await fs.rm(abs, { force: true });
        continue;
      }

      // created / modified precisam de conteúdo
      if (!ev.content || ev.encoding !== "utf-8") {
        // por enquanto, se não tiver conteúdo, não aplica
        // (isso vai sumir depois que todo evento de md vier com content)
        continue;
      }

      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, ev.content, "utf-8");
    }
  }
}
