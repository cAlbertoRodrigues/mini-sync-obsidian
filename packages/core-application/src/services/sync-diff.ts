import type { Conflict, ConflictType } from "@mini-sync/core-domain";
import type { FileSyncState } from "../value-objects/file-sync-state";

type Hash = string | null | undefined;

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

  lastSyncedHash?: Hash;
  lastLocalHash?: Hash;
  lastRemoteHash?: Hash;

  conflict?: Conflict;
};

function hashEq(a?: Hash, b?: Hash): boolean {
  if (!a || !b) return false;
  return a === b;
}

function differsFromBase(current?: Hash, base?: Hash): boolean {
  if (!current) return false;
  if (!base) return true; // sem base => considera "mudou"
  return !hashEq(current, base);
}

export function detectConflictFromState(state: FileSyncState): Conflict | null {
  const local = state.lastLocalHash as Hash;
  const remote = state.lastRemoteHash as Hash;
  const base = state.lastSyncedHash as Hash;

  if (!local || !remote) return null;

  const localChanged = differsFromBase(local, base);
  const remoteChanged = differsFromBase(remote, base);

  if (!localChanged && !remoteChanged) return null;

  if (hashEq(local, remote)) return null;

  if (localChanged && remoteChanged) {
    const type: ConflictType = "modified_modified";
    return {
      path: state.path,
      type,
      localHash: local,
      remoteHash: remote,
    };
  }

  return null;
}

export function compareFileState(state: FileSyncState): FileComparison {
  const local = state.lastLocalHash as Hash;
  const remote = state.lastRemoteHash as Hash;
  const base = state.lastSyncedHash as Hash;

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

  if (local && remote) {
    if (base && hashEq(local, base) && hashEq(remote, base)) {
      return {
        path: state.path,
        status: "synced",
        lastSyncedHash: base,
        lastLocalHash: local,
        lastRemoteHash: remote,
      };
    }

    if (differsFromBase(local, base) && !differsFromBase(remote, base)) {
      return {
        path: state.path,
        status: "local_changed",
        lastSyncedHash: base,
        lastLocalHash: local,
        lastRemoteHash: remote,
      };
    }

    if (!differsFromBase(local, base) && differsFromBase(remote, base)) {
      return {
        path: state.path,
        status: "remote_changed",
        lastSyncedHash: base,
        lastLocalHash: local,
        lastRemoteHash: remote,
      };
    }

    return {
      path: state.path,
      status: "unknown",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (local && !remote) {
    return {
      path: state.path,
      status: base ? "local_changed" : "local_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  if (!local && remote) {
    return {
      path: state.path,
      status: base ? "remote_changed" : "remote_only",
      lastSyncedHash: base,
      lastLocalHash: local,
      lastRemoteHash: remote,
    };
  }

  return {
    path: state.path,
    status: "unknown",
    lastSyncedHash: base,
    lastLocalHash: local,
    lastRemoteHash: remote,
  };
}

export function compareAllStates(states: Record<string, FileSyncState>) {
  const comparisons = Object.values(states)
    .map(compareFileState)
    .sort((a, b) => a.path.localeCompare(b.path));

  const conflicts = comparisons
    .filter((c) => c.status === "conflict" && c.conflict)
    .map((c) => c.conflict!);

  return { comparisons, conflicts };
}
