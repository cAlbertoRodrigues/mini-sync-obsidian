// apps/desktop/src/ui/views/vault-list-view.ts
import { el } from "../utils/dom.js";
import type { VaultItem } from "../state/vaults-store.js";

type Props = {
  vaults: VaultItem[];
  selectedVaultId: string | null;
  onSelectVault: (id: string) => void;
  onAddVault: () => void;
  onOpenSettings: () => void;
};

function statusClass(status?: VaultItem["status"]) {
  switch (status) {
    case "syncing":
      return "ms-status ms-status--syncing";
    case "ok":
      return "ms-status ms-status--ok";
    case "error":
      return "ms-status ms-status--error";
    case "idle":
    default:
      return "ms-status ms-status--idle";
  }
}

export function renderVaultList(props: Props): HTMLElement[] {
  const header = el("div", { className: "ms-sidebar-header" });
  header.append(el("div", { className: "ms-sidebar-title", textContent: "VAULTS" }));

  const actions = el("div", { className: "ms-sidebar-actions" });

  const addBtn = el("button", { className: "ms-icon-btn", title: "Adicionar vault" });
  addBtn.textContent = "+";
  addBtn.addEventListener("click", props.onAddVault);

  const settingsBtn = el("button", { className: "ms-icon-btn", title: "Configurações" });
  settingsBtn.textContent = "⚙";
  settingsBtn.addEventListener("click", props.onOpenSettings);

  actions.append(addBtn, settingsBtn);
  header.append(actions);

  const list = el("div", { className: "ms-vault-list" });

  for (const v of props.vaults) {
    const row = el("button", {
      className: "ms-vault-item" + (props.selectedVaultId === v.id ? " is-active" : ""),
    });

    // linha do nome + status
    const nameRow = el("div", { className: "ms-vault-name-row" });
    nameRow.append(
      el("span", { className: statusClass(v.status) }),
      el("div", { className: "ms-vault-name", textContent: v.name })
    );

    // meta
    let metaText = "";
    if (v.provider === "local") {
      metaText = `Local • ${v.localPath ?? ""}`.trim();
    } else {
      const label = v.remoteLabel ?? "Remoto";
      metaText = `${label}${v.remotePath ? ` • ${v.remotePath}` : ""}`;
    }

    // statusText pequeno (opcional)
    const statusText = v.statusText ? ` • ${v.statusText}` : "";
    const meta = el("div", { className: "ms-vault-meta", textContent: metaText + statusText });

    row.append(nameRow, meta);
    row.addEventListener("click", () => props.onSelectVault(v.id));
    list.append(row);
  }

  return [header, list];
}
