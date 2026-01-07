import type { HistoryEvent } from "../value-objects/history-event";

export type SyncCursor = {
  value: string; 
};

export interface SyncProvider {
  // envia eventos locais para o remoto
  pushHistoryEvents(events: HistoryEvent[]): Promise<void>;

  // busca eventos do remoto a partir de um cursor
  pullHistoryEvents(cursor: SyncCursor | null): Promise<{
    events: HistoryEvent[];
    nextCursor: SyncCursor | null;
  }>;
}
