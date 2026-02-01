import type { VaultProviderId } from "../providers/providers.js";

export type VaultSyncStatus = "idle" | "syncing" | "ok" | "error";

export type VaultItem = {
  id: string;
  name: string;
  provider: VaultProviderId;

  // local
  localPath?: string;

  // remote (ex.: google drive)
  remoteLabel?: string;
  remotePath?: string;

  // status UI
  status?: VaultSyncStatus;
  statusText?: string;
};

const KEY = "miniSync.vaults.v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isVaultProviderId(v: unknown): v is VaultProviderId {
  return v === "local" || v === "google-drive";
}

function isVaultSyncStatus(v: unknown): v is VaultSyncStatus {
  return v === "idle" || v === "syncing" || v === "ok" || v === "error";
}

function normalizeOne(x: unknown): VaultItem | null {
  if (!isRecord(x)) return null;

  const id = typeof x.id === "string" ? x.id : null;
  const name = typeof x.name === "string" ? x.name : null;
  const provider = isVaultProviderId(x.provider) ? x.provider : null;

  if (!id || !name || !provider) return null;

  const localPath = typeof x.localPath === "string" ? x.localPath : undefined;
  const remoteLabel = typeof x.remoteLabel === "string" ? x.remoteLabel : undefined;
  const remotePath = typeof x.remotePath === "string" ? x.remotePath : undefined;

  const status: VaultSyncStatus = isVaultSyncStatus(x.status) ? x.status : "idle";
  const statusText =
    typeof x.statusText === "string" ? x.statusText : statusLabel(status);

  return {
    id,
    name,
    provider,
    localPath,
    remoteLabel,
    remotePath,
    status,
    statusText,
  };
}

function normalizeVaults(list: unknown): VaultItem[] {
  if (!Array.isArray(list)) return [];
  const out: VaultItem[] = [];
  for (const item of list) {
    const v = normalizeOne(item);
    if (v) out.push(v);
  }
  return out;
}

function statusLabel(s: VaultSyncStatus): string {
  switch (s) {
    case "idle":
      return "Idle";
    case "syncing":
      return "Syncing...";
    case "ok":
      return "Up to date";
    case "error":
      return "Error";
  }
}

export function loadVaults(): VaultItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return normalizeVaults(parsed);
  } catch {
    return [];
  }
}

export function saveVaults(vaults: VaultItem[]) {
  localStorage.setItem(KEY, JSON.stringify(vaults));
}

export function upsertVault(vault: VaultItem) {
  // garante defaults de status antes de salvar
  const normalized: VaultItem = {
    ...vault,
    status: vault.status ?? "idle",
    statusText: vault.statusText ?? statusLabel(vault.status ?? "idle"),
  };

  const list = loadVaults();
  const idx = list.findIndex((v) => v.id === normalized.id);

  if (idx >= 0) list[idx] = normalized;
  else list.push(normalized);

  saveVaults(list);
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function deleteVault(vaultId: string) {
  const list = loadVaults().filter((v) => v.id !== vaultId);
  saveVaults(list);
}
