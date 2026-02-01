// apps/desktop/src/ui/state/vaults-store.ts
import type { VaultProviderId } from "../providers/providers.js";

export type VaultSyncStatus = "idle" | "syncing" | "ok" | "error";

export type VaultLogEntry = {
  ts: number;
  message: string;
};

export type VaultItem = {
  id: string;
  name: string;
  provider: VaultProviderId;

  localPath?: string;

  remoteLabel?: string;
  remotePath?: string;

  status?: VaultSyncStatus;
  statusText?: string;

  logs?: VaultLogEntry[];
};

const KEY = "miniSync.vaults.v1";

function normalizeVault(v: VaultItem): VaultItem {
  return {
    ...v,
    status: v.status ?? "idle",
    statusText: v.statusText ?? "Idle",
    logs: Array.isArray(v.logs) ? v.logs : [],
  };
}

export function loadVaults(): VaultItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as VaultItem[]).map(normalizeVault);
  } catch {
    return [];
  }
}

export function saveVaults(vaults: VaultItem[]) {
  localStorage.setItem(KEY, JSON.stringify(vaults));
}

export function upsertVault(vault: VaultItem) {
  const list = loadVaults();
  const idx = list.findIndex((v) => v.id === vault.id);

  const next = normalizeVault(vault);
  if (idx >= 0) list[idx] = next;
  else list.push(next);

  saveVaults(list);
}

export function deleteVault(vaultId: string) {
  const list = loadVaults().filter((v) => v.id !== vaultId);
  saveVaults(list);
}

export function appendVaultLog(vaultId: string, message: string) {
  const list = loadVaults();
  const idx = list.findIndex((v) => v.id === vaultId);
  if (idx < 0) return;

  const v = normalizeVault(list[idx]);
  const entry: VaultLogEntry = { ts: Date.now(), message };

  v.logs = [...(v.logs ?? []), entry];
  list[idx] = v;
  saveVaults(list);
}

export function setVaultStatus(vaultId: string, status: VaultSyncStatus, statusText?: string) {
  const list = loadVaults();
  const idx = list.findIndex((v) => v.id === vaultId);
  if (idx < 0) return;

  const v = normalizeVault(list[idx]);
  v.status = status;
  v.statusText = statusText ?? v.statusText ?? "Idle";
  list[idx] = v;
  saveVaults(list);
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}
