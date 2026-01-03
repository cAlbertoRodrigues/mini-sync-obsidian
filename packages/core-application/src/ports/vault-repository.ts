import type { VaultId } from '@mini-sync/core-domain';
import type { Snapshot, ChangeSet } from '@mini-sync/core-domain';

export interface VaultRepository {
  /** Gera um snapshot do vault (via adapter real depois) */
  generateSnapshot(vaultId: VaultId): Promise<Snapshot>;

  /** Aplica mudanças no vault */
  applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void>;
}
