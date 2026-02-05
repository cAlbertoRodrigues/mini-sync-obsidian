import type { SyncStatusPayload } from "../models/sync.js";
import type { ChangeRow } from "../models/changes.js";
import { setVaultSyncState } from "../state/sync-status-store.js";

type RunSyncArgs = {
  vaultId: string;
  remoteRootDir: string;
  defaultStrategy?: "local" | "remote";
};

export async function runSyncNow(args: RunSyncArgs) {
  const { vaultId } = args;

  setVaultSyncState(vaultId, {
    status: "syncing",
    lastAtIso: new Date().toISOString(),
    lastError: undefined,
  });

  return await window.api.invoke<{ ok: true; summary: any }>("sync:run", {
    vaultId,
    mode: "remote-folder",
    remoteRootDir: args.remoteRootDir,
    defaultStrategy: args.defaultStrategy ?? "local",
  });
}

export async function loadChanges(vaultId: string): Promise<ChangeRow[]> {
  return await window.api.invoke<ChangeRow[]>("changes:list", { vaultId });
}

/**
 * Escuta eventos de status do main process e atualiza store.
 * Retorna unsubscribe.
 */
export function subscribeSyncStatus(onUpdate?: (p: SyncStatusPayload) => void) {
  // ✅ TIPADO: evita implicit any
  return window.api.on<SyncStatusPayload>("sync:status", (p: SyncStatusPayload) => {
    if (p.status === "syncing") {
      setVaultSyncState(p.vaultId, {
        status: "syncing",
        lastAtIso: p.atIso,
        lastError: undefined,
      });
    } else if (p.status === "ok") {
      setVaultSyncState(p.vaultId, {
        status: "ok",
        lastAtIso: p.atIso,
        lastError: undefined,
      });
    } else if (p.status === "conflict") {
      setVaultSyncState(p.vaultId, {
        status: "conflict",
        lastAtIso: p.atIso,
        lastError: undefined,
      });
    } else if (p.status === "error") {
      setVaultSyncState(p.vaultId, {
        status: "error",
        lastAtIso: p.atIso,
        lastError: p.error,
      });
    }

    onUpdate?.(p);
  });
}
