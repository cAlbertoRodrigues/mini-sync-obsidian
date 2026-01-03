import type { DeviceId, VaultId, SnapshotId, ChangeSet, Conflict } from '@mini-sync/core-domain';

export type PushResult =
  | { type: 'ok'; newSnapshotId: SnapshotId }
  | { type: 'conflict'; conflicts: Conflict[] };

export interface SyncTransport {
  pushChanges(params: {
    vaultId: VaultId;
    deviceId: DeviceId;
    baseSnapshotId: SnapshotId | null;
    changeSet: ChangeSet;
  }): Promise<PushResult>;

  pullUpdates(params: {
    vaultId: VaultId;
    deviceId: DeviceId;
    sinceSnapshotId: SnapshotId | null;
  }): Promise<{ changeSet: ChangeSet; newSnapshotId: SnapshotId }>;
}
