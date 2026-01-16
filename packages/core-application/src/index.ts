// Public API exports for the core-application package. This file exposes
// interfaces (ports), value objects, services and node-specific adapters so
// that applications can import the pieces they need without reaching into
// internal file paths. Additional exports can be added here as the
// application grows.

// Ports (interfaces)
export * from "./ports/clock";
export * from "./ports/logger";
export * from "./ports/snapshot-store";
export * from "./ports/vault-repository";
export * from "./ports/sync-transport";
export * from "./ports/sync-provider";
export * from "./ports/history-repository";

// ✅ conflito resolvido: exporta somente o tipo do resolver (sem re-exportar ConflictDecision)
export type { ConflictResolver } from "./ports/conflict-resolver";

// ✅ dono oficial do tipo ConflictDecision fica aqui
export type {
  ConflictDecision,
  ConflictDecisionStore,
} from "./ports/conflict-decision-store";

// file-watcher: exporta só o watcher (evita conflito com FileHash/FileHasher)
export type {
  FileChangeType,
  FileChangeEvent,
  FileWatcherOptions,
  FileWatcher,
} from "./ports/file-watcher";

// file-hasher: exporta o hash canonical daqui
export type { FileHash, FileHasher } from "./ports/file-hasher";

// Value objects
export * from "./value-objects/file-metadata";
export * from "./value-objects/file-sync-state";
export * from "./value-objects/history-event";

// Services
export * from "./services/sync-diff";
export * from "./services/keep-local";
export * from "./services/keep-remote";

// Node adapters (optional for consumers who run in a Node environment)
export * from "./adapters/node-vault-repository";
export * from "./adapters/node-snapshot-store";
export * from "./adapters/node-sync-state-store";
export * from "./adapters/node-history-repository";
export * from "./adapters/node-conflict-decision-store";
export * from "./adapters/node-remote-cursor-store";
export * from "./adapters/remote-folder-sync-provider";
export * from "./adapters/vault-event-applier";
export * from "./adapters/chokidar-file-watcher";
export * from "./adapters/node-file-hasher";
export * from "./adapters/apply-lock";
export * from "./adapters/obsidian-ignore";
