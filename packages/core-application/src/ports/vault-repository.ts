import type { VaultId } from '@mini-sync/core-domain';
import type { Snapshot, ChangeSet } from '@mini-sync/core-domain';

export interface VaultRepository {
  generateSnapshot(vaultId: VaultId): Promise<Snapshot>;

  applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void>;
}
