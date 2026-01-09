import type { Conflict, ConflictType } from "@mini-sync/core-domain";
import type { FileSyncState } from "../value-objects/file-sync-state";

/**
 * Hash pode vir como:
 * - string
 * - { algorithm, value }
 * - undefined
 */
type HashLike = string | { algorithm?: string; value?: string } | undefined;

export type FileStatus =
  | "unchanged"
  | "local_only"
  | "remote_only"
  | "synced"
  | "local_changed"
  | "remote_changed"
  | "conflict"
  | "unknown";

export type FileComparison = {
  path: string;
  status: FileStatus;

  lastSyncedHash?: string;
  lastLocalHash?: string;
  lastRemoteHash?: string;

  conflict?: Conflict;
};

/* ---------------- helpers ---------------- */

function normalizeHash(h: HashLike): string | undefined {
  if (!h) return undefined;
  if (typeof h === "string") return h;
  if (typeof h === "object" && typeof h.value === "string") return h.value;
  return undefined;
}

function differsFromBase(current?: string, base?: string): boolean {
  if (!current) return false;
  if (!base) return true;
  return current !== base;
}

function isFileSyncState(x: any): x is FileSyncState {
  return !!x && typeof x === "object" && typeof x.path === "string";
}

/**
 * Normaliza entrada do store para uma lista de FileSyncState.
 * Suporta:
 * - FileSyncState[]
 * - Record<string, FileSyncState>
 * - { files: Record<string, FileSyncState> }
 */
function normalizeStatesInput(
  states: any
): FileSyncState[] {
  if (!states) return [];

  // array
  if (Array.isArray(states)) {
    return states.filter(isFileSyncState);
  }

  // { files: {...} }
  if (typeof states === "object" && states.files && typeof states.files === "object") {
    return Object.values(states.files).filter(isFileSyncState);
  }

  // Record<string, FileSyncState>
  if (typeof states === "object") {
    return Object.values(states).filter(isFileSyncState);
  }

  return [];
}

/* ---------------- conflict detection ---------------- */

export function detectConflictFromState(state: FileSyncState): Conflict | null {
  const local = normalizeHash(state.lastLocalHash as any);
  const remote = normalizeHash(state.lastRemoteHash as any);
  const base = normalizeHash(state.lastSyncedHash as any);

  const localExists = !!local;
  const remoteExists = !!remote;

  const localChanged = localExists ? differsFromBase(local, base) : !!base;
  const remoteChanged = remoteExists ? differsFromBase(remote, base) : !!base;

  // nada mudou
  if (!localChanged && !remoteChanged) return null;

  // ambos existem e são iguais
  if (localExists && remoteExists && local === remote) return null;

  // modified_modified
  if (localExists && remoteExists && localChanged && remoteChanged && local !== remote) {
    const type: ConflictType = "modified_modified";
    return {
      path: state.path,
      type,
      localHash: local,
      remoteHash: remote,
    };
  }

  // deleted_modified (local deletou)
  if (!localExists && remoteExists && localChanged && remoteChanged) {
    const type: ConflictType = "deleted_modified";
    return {
      path: state.path,
      type,
      localHash: undefined,
      remoteHash: remote,
    };
  }

  // modified_deleted (remoto deletou)
  if (localExists && !remoteExists && localChanged && remoteChanged) {
    const type: ConflictType = "modified_deleted";
    return {
      path: state.path,
      type,
      localHash: local,
      remoteHash: undefined,
    };
  }

  return null;
}

/* ---------------- comparison ---------------- */

export function compareFileState(state: FileSyncState): FileComparison {
  const local = normalizeHash(state.lastLocalHash as any);
  const remote = normalizeHash(state.lastRemoteHash as any);
  const base = normalizeHash(state.lastSyncedHash as any);

  const conflict = detectConflictFromState(state);
  if (conflict) {
    return {
      path: state.path,
      status: "conflict",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
      conflict,
    };
  }

  // synced (base presente e todos iguais)
  if (local && remote && base && local === base && remote === base) {
    return {
      path: state.path,
      status: "synced",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  // sem base, mas local == remote
  if (local && remote && !base && local === remote) {
    return {
      path: state.path,
      status: "synced",
      lastSyncedHash: local,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  // local mudou e remoto não
  if (local && !differsFromBase(remote, base) && differsFromBase(local, base)) {
    return {
      path: state.path,
      status: base ? "local_changed" : "local_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  // remoto mudou e local não
  if (remote && !differsFromBase(local, base) && differsFromBase(remote, base)) {
    return {
      path: state.path,
      status: base ? "remote_changed" : "remote_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  // só local existe
  if (local && !remote) {
    return {
      path: state.path,
      status: base ? "local_changed" : "local_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: undefined,
    };
  }

  // só remoto existe
  if (!local && remote) {
    return {
      path: state.path,
      status: base ? "remote_changed" : "remote_only",
      lastSyncedHash: base,
      lastLocalHash: undefined,
      lastRemoteHash: remote,
    };
  }

  return {
    path: state.path,
    status: base ? "unchanged" : "unknown",
    lastSyncedHash: base,
    lastLocalHash: local,
    lastRemoteHash: remote,
  };
}

export function compareAllStates(states: any) {
  const list = normalizeStatesInput(states);

  const comparisons = list
    .map(compareFileState)
    .sort((a, b) => a.path.localeCompare(b.path));

  const conflicts = comparisons
    .filter((c) => c.status === "conflict" && c.conflict)
    .map((c) => c.conflict!);

  return { comparisons, conflicts };
}
