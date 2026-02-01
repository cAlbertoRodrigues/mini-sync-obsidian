import { el } from "../utils/dom.js";
import type { VaultItem } from "../state/vaults-store.js";
import { PROVIDERS } from "../providers/providers.js";

type Props = {
  vault: VaultItem;
  onBack: () => void;
  onSave: (vault: VaultItem) => void;
  onDelete: (vaultId: string) => void;
};

export function renderVaultSetupView(props: Props): HTMLElement {
  const wrap = el("div", { className: "ms-setup" });

  const top = el("div", { className: "ms-setup-top" });
  const back = el("button", { className: "ms-link-btn", textContent: "← Voltar" });
  back.addEventListener("click", props.onBack);

  const heading = el("div", { className: "ms-setup-heading" });
  heading.append(
    el("h2", { className: "ms-setup-title", textContent: "Configurar vault" }),
    el("p", {
      className: "ms-setup-subtitle",
      textContent: "Selecione o provider e preencha os dados.",
    })
  );

  top.append(back, heading);

  const card = el("div", { className: "ms-card" });

  function field(label: string, control: HTMLElement): HTMLElement {
    const row = el("div", { className: "ms-field" });
    row.append(el("div", { className: "ms-field-label", textContent: label }), control);
    return row;
  }

  // Nome
  const nameInput = el("input", {
    className: "ms-input",
    value: props.vault.name ?? "",
    placeholder: "Nome do vault",
  }) as HTMLInputElement;

  // Provider
  const providerSelect = el("select", { className: "ms-input" }) as HTMLSelectElement;
  for (const p of PROVIDERS) {
    const opt = el("option", {
      value: p.id,
      textContent: `${p.label} — ${p.description}`,
    }) as HTMLOptionElement;

    if (p.id === props.vault.provider) opt.selected = true;
    providerSelect.append(opt);
  }

  const dynamicArea = el("div", { className: "ms-setup-dynamic" });

  type LocalRefs = { localPath: HTMLInputElement };
  type RemoteRefs = { remoteLabel: HTMLInputElement; remotePath: HTMLInputElement };
  let dynamicRefs: LocalRefs | RemoteRefs;

  function renderDynamic(provider: VaultItem["provider"]) {
    dynamicArea.replaceChildren();

    if (provider === "local") {
      const localPath = el("input", {
        className: "ms-input",
        value: props.vault.localPath ?? "",
        placeholder: "Caminho local (ex: C:\\Vaults\\MeuVault)",
      }) as HTMLInputElement;

      dynamicArea.append(field("Caminho local", localPath));
      dynamicRefs = { localPath };
      return;
    }

    const remoteLabel = el("input", {
      className: "ms-input",
      value: props.vault.remoteLabel ?? "Google Drive",
      placeholder: "Label (ex: Google Drive)",
    }) as HTMLInputElement;

    const remotePath = el("input", {
      className: "ms-input",
      value: props.vault.remotePath ?? "/MiniSync/MeuVault",
      placeholder: "Caminho remoto (ex: /MiniSync/VaultA)",
    }) as HTMLInputElement;

    dynamicArea.append(field("Label", remoteLabel), field("Destino remoto", remotePath));
    dynamicRefs = { remoteLabel, remotePath };
  }

  renderDynamic(props.vault.provider);

  providerSelect.addEventListener("change", () => {
    const provider = providerSelect.value as VaultItem["provider"];
    renderDynamic(provider);
  });

  card.append(field("Nome", nameInput), field("Provider", providerSelect), dynamicArea);

  const footer = el("div", { className: "ms-setup-footer" });

  const deleteBtn = el("button", { className: "ms-danger", textContent: "Excluir vault" });
  deleteBtn.addEventListener("click", () => {
    const ok = confirm(`Excluir o vault "${props.vault.name}"?`);
    if (!ok) return;
    props.onDelete(props.vault.id);
  });

  const saveBtn = el("button", { className: "ms-primary", textContent: "Salvar" });
  saveBtn.addEventListener("click", () => {
    const provider = providerSelect.value as VaultItem["provider"];

    const updated: VaultItem = {
      ...props.vault,
      name: nameInput.value.trim() || props.vault.name,
      provider,
      localPath: provider === "local" ? (dynamicRefs as LocalRefs).localPath.value : undefined,
      remoteLabel: provider !== "local" ? (dynamicRefs as RemoteRefs).remoteLabel.value : undefined,
      remotePath: provider !== "local" ? (dynamicRefs as RemoteRefs).remotePath.value : undefined,
    };

    props.onSave(updated);
  });

  footer.append(deleteBtn, saveBtn);

  wrap.append(top, card, footer);
  return wrap;
}
