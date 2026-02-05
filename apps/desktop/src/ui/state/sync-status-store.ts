import type { SyncUiStatus } from "../models/sync.js";

type VaultSyncState = {
  status: SyncUiStatus;
  lastAtIso?: string;
  lastError?: string;
};

const stateByVault = new Map<string, VaultSyncState>();

export function getVaultSyncState(vaultId: string): VaultSyncState {
  return stateByVault.get(vaultId) ?? { status: "idle" };
}

export function setVaultSyncState(vaultId: string, patch: Partial<VaultSyncState>) {
  const prev = getVaultSyncState(vaultId);
  stateByVault.set(vaultId, { ...prev, ...patch });
}

export function getStatusLabel(status: SyncUiStatus) {
  switch (status) {
    case "idle":
      return "Idle";
    case "syncing":
      return "Syncing...";
    case "ok":
      return "OK";
    case "conflict":
      return "Conflicts";
    case "error":
      return "Error";
  }
}
