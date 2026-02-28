import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";

export type SyncCursor = { value: string };

export type BlobKey = { sha256: string };
export type SnapshotKey = { id: string };

export interface SyncProvider {
  // eventos
  pushHistoryEvents(events: HistoryEvent[]): Promise<void>;
  pullHistoryEvents(
    cursor: SyncCursor | null
  ): Promise<{ events: HistoryEvent[]; nextCursor: SyncCursor | null }>;

  // blobs/attachments (dedupe por hash)
  hasBlob(key: BlobKey): Promise<boolean>;
  putBlob(key: BlobKey, data: Buffer): Promise<void>;
  getBlob(key: BlobKey): Promise<Buffer>;

  // snapshots (manifesto)
  listSnapshots(): Promise<SnapshotKey[]>; // ordenação fica por provider
  putSnapshotManifest(key: SnapshotKey, manifest: SnapshotManifest): Promise<void>;
  getSnapshotManifest(key: SnapshotKey): Promise<SnapshotManifest>;
}