import type { DeviceId, VaultId } from '@mini-sync/core-domain';
import type { Snapshot, SnapshotId } from '@mini-sync/core-domain';

export interface SnapshotStore {
  getLastSyncedSnapshotId(vaultId: VaultId, deviceId: DeviceId): Promise<SnapshotId | null>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  markAsLastSynced(vaultId: VaultId, deviceId: DeviceId, snapshotId: SnapshotId): Promise<void>;
}
