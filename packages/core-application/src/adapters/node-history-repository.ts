import fs from "fs/promises";
import path from "path";
import type { HistoryRepository } from "../ports/history-repository";
import type { HistoryEvent } from "../value-objects/history-event";

export class NodeHistoryRepository implements HistoryRepository {
  private getBaseDir(rootDir: string) {
    return path.join(rootDir, ".mini-sync", "history");
  }

  async ensureStructure(rootDir: string): Promise<void> {
    const base = this.getBaseDir(rootDir);
    await fs.mkdir(base, { recursive: true });
  }

  async append(rootDir: string, event: HistoryEvent): Promise<void> {
    await this.ensureStructure(rootDir);

    const date = event.occurredAtIso.slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(
      this.getBaseDir(rootDir),
      `${date}.jsonl`
    );

    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  }
}
