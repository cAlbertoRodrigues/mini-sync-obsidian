import type { VaultId } from '../value-objects/ids';
import type { FileRecord } from './file-record';

export type SnapshotId = string;

export interface Snapshot {
  id: SnapshotId;
  vaultId: VaultId;
  createdAtMs: number;
  files: FileRecord[];
}
