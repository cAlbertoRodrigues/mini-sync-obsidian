import { el } from "../utils/dom.js";
import type { VaultItem } from "../onboarding.js";

type Props = {
  vaults: VaultItem[];
  selectedVaultId: string | null;
  onSelectVault: (id: string) => void;
  onAddVault: () => void;
  onOpenSettings: () => void;
};

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

    const name = el("div", { className: "ms-vault-name", textContent: v.name });

    let metaText = "";
    if (v.provider === "local") {
      metaText = `Local • ${v.localPath ?? ""}`.trim();
    } else {
      const label = v.remoteLabel ?? "Remoto";
      metaText = `${label}${v.remotePath ? ` • ${v.remotePath}` : ""}`;
    }

    const meta = el("div", { className: "ms-vault-meta", textContent: metaText });

    row.append(name, meta);
    row.addEventListener("click", () => props.onSelectVault(v.id));
    list.append(row);
  }

  return [header, list];
}
