import type { HistoryEvent } from "../value-objects/history-event";

export interface HistoryRepository {
  ensureStructure(rootDir: string): Promise<void>;
  append(rootDir: string, event: HistoryEvent): Promise<void>;
}
