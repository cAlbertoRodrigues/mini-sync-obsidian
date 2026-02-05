// exports mínimos para o Desktop (evita TS2835 com barrel gigante)

export { RemoteFolderSyncProvider } from "./adapters/remote-folder-sync-provider";
export { NodeRemoteCursorStore } from "./adapters/node-remote-cursor-store";
export { VaultEventApplier } from "./adapters/vault-event-applier";

export { NodeSyncStateStore } from "./adapters/node-sync-state-store";
export { NodeFileHasher } from "./adapters/node-file-hasher";
export { NodeHistoryRepository } from "./adapters/node-history-repository";
export { NodeConflictDecisionStore } from "./adapters/node-conflict-decision-store";

export { compareAllStates } from "./services/sync-diff";
export { SyncService } from "./services/sync-service";

// Types que o Desktop pode precisar (opcional)
export type { ConflictResolutionStrategy } from "./ports/conflict-decision-store";
