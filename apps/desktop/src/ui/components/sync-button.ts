import { getVaultSyncState, getStatusLabel } from "../state/sync-status-store.js";

export function renderSyncButton(opts: {
  vaultId: string;
  onClick: () => void | Promise<void>;
}) {
  const s = getVaultSyncState(opts.vaultId);

  const disabled = s.status === "syncing";
  const label = s.status === "syncing" ? "Syncing..." : "Sync now";

  const wrap = document.createElement("div");
  wrap.className = "sync-actions";

  const status = document.createElement("div");
  status.className = `sync-status sync-${s.status}`;
  status.textContent = `Status: ${getStatusLabel(s.status)}`;

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = label;
  btn.disabled = disabled;
  btn.onclick = () => void opts.onClick();

  wrap.appendChild(status);
  wrap.appendChild(btn);

  return wrap;
}
