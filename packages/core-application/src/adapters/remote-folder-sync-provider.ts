import fs from "fs/promises";
import path from "path";
import type { SyncProvider, SyncCursor } from "../ports/sync-provider";
import type { HistoryEvent } from "../value-objects/history-event";

function parseCursor(cursor: SyncCursor | null): { date: string; line: number } | null {
  if (!cursor) return null;
  const [date, lineStr] = cursor.value.split(":");
  const line = Number(lineStr);
  if (!date || Number.isNaN(line)) return null;
  return { date, line };
}

function makeCursor(date: string, line: number): SyncCursor {
  return { value: `${date}:${line}` };
}

function dateFromIso(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export class RemoteFolderSyncProvider implements SyncProvider {
  constructor(private readonly remoteRootDir: string) {}

  private historyDir(): string {
    return path.join(this.remoteRootDir, "mini-sync", "history");
  }

  private historyFile(date: string): string {
    return path.join(this.historyDir(), `${date}.jsonl`);
  }

  private async ensureStructure(): Promise<void> {
    await fs.mkdir(this.historyDir(), { recursive: true });
  }

  async pushHistoryEvents(events: HistoryEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.ensureStructure();

    // agrupa por dia para manter 1 arquivo por dia
    const byDate = new Map<string, HistoryEvent[]>();
    for (const e of events) {
      const d = dateFromIso(e.occurredAtIso);
      const list = byDate.get(d) ?? [];
      list.push(e);
      byDate.set(d, list);
    }

    for (const [date, list] of byDate.entries()) {
      const filePath = this.historyFile(date);
      const lines = list.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(filePath, lines, "utf-8");
    }
  }

  async pullHistoryEvents(cursor: SyncCursor | null): Promise<{ events: HistoryEvent[]; nextCursor: SyncCursor | null }> {
    await this.ensureStructure();

    const cur = parseCursor(cursor);

    // lista arquivos YYYY-MM-DD.jsonl em ordem
    const files = (await fs.readdir(this.historyDir()))
      .filter((f) => f.endsWith(".jsonl"))
      .sort(); // ordena por nome => por data

    const events: HistoryEvent[] = [];

    let lastDate: string | null = null;
    let lastLine = -1;

    for (const file of files) {
      const date = file.replace(".jsonl", "");

      // Se cursor existe, pula tudo antes da data
      if (cur && date < cur.date) continue;

      const content = await fs.readFile(path.join(this.historyDir(), file), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      const startLine = cur && date === cur.date ? cur.line + 1 : 0;

      for (let i = startLine; i < lines.length; i++) {
        const line = lines[i]!;
        try {
          const parsed = JSON.parse(line) as HistoryEvent;
          events.push(parsed);
          lastDate = date;
          lastLine = i;
        } catch {
          // ignora linha inválida (tolerância)
        }
      }
    }

    if (lastDate === null) {
      // nada novo
      return { events: [], nextCursor: cursor };
    }

    return { events, nextCursor: makeCursor(lastDate, lastLine) };
  }
}
