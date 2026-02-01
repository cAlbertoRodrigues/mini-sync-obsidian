// apps/desktop/src/ui/views/vault-setup-view.ts
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

  // Trabalha em um draft local pra não depender de mutação de props
  let draft: VaultItem = { ...props.vault };

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

  const nameInput = el("input", {
    className: "ms-input",
    value: draft.name ?? "",
    placeholder: "Nome do vault",
  }) as HTMLInputElement;

  // provider select
  const providerSelect = el("select", { className: "ms-input" }) as HTMLSelectElement;
  for (const p of PROVIDERS) {
    const opt = el("option", {
      value: p.id,
      textContent: `${p.label} — ${p.description}`,
    }) as HTMLOptionElement;
    if (p.id === draft.provider) opt.selected = true;
    providerSelect.append(opt);
  }

  const dynamicArea = el("div", { className: "ms-setup-dynamic" });

  // refs atuais (mudam conforme provider)
  let localPathRef: HTMLInputElement | null = null;
  let remoteLabelRef: HTMLInputElement | null = null;
  let remotePathRef: HTMLInputElement | null = null;

  function renderDynamic(provider: VaultItem["provider"]) {
    dynamicArea.replaceChildren();
    localPathRef = null;
    remoteLabelRef = null;
    remotePathRef = null;

    if (provider === "local") {
      const localPath = el("input", {
        className: "ms-input",
        value: draft.localPath ?? "",
        placeholder: "Caminho local (ex: C:\\Vaults\\MeuVault)",
      }) as HTMLInputElement;

      dynamicArea.append(field("Caminho local", localPath));
      localPathRef = localPath;
      return;
    }

    const remoteLabel = el("input", {
      className: "ms-input",
      value: draft.remoteLabel ?? "Google Drive",
      placeholder: "Label (ex: Google Drive)",
    }) as HTMLInputElement;

    const remotePath = el("input", {
      className: "ms-input",
      value: draft.remotePath ?? "/MiniSync/MeuVault",
      placeholder: "Caminho remoto (ex: /MiniSync/VaultA)",
    }) as HTMLInputElement;

    dynamicArea.append(field("Label", remoteLabel), field("Destino remoto", remotePath));
    remoteLabelRef = remoteLabel;
    remotePathRef = remotePath;
  }

  renderDynamic(draft.provider);

  providerSelect.addEventListener("change", () => {
    const provider = providerSelect.value as VaultItem["provider"];

    // Atualiza draft e LIMPA campos do outro provider (muito importante)
    draft = { ...draft, provider };

    if (provider === "local") {
      draft.remoteLabel = undefined;
      draft.remotePath = undefined;
      // mantém localPath (se existia), senão vazio
      draft.localPath = draft.localPath ?? "";
    } else {
      draft.localPath = undefined;
      draft.remoteLabel = draft.remoteLabel ?? "Google Drive";
      draft.remotePath = draft.remotePath ?? "/MiniSync/MeuVault";
    }

    renderDynamic(provider);
  });

  card.append(field("Nome", nameInput), field("Provider", providerSelect), dynamicArea);

  // logs section
  const logsSection = el("div", { className: "ms-logs" });
  logsSection.append(
    el("h3", { className: "ms-logs-title", textContent: "Logs de sincronização" })
  );

  const logList = el("div", { className: "ms-log-list" });

  const logs = Array.isArray(props.vault.logs) ? props.vault.logs : [];
  if (logs.length > 0) {
    logs
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .forEach((entry) => {
        const dateStr = new Date(entry.ts).toLocaleString();
        logList.append(
          el("div", {
            className: "ms-log-entry",
            textContent: `[${dateStr}] ${entry.message}`,
          })
        );
      });
  } else {
    logList.append(el("p", { className: "ms-log-empty", textContent: "Nenhum log ainda." }));
  }

  logsSection.append(logList);
  card.append(logsSection);

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
      ...draft,
      name: nameInput.value.trim() || draft.name,
      provider,
      localPath: provider === "local" ? (localPathRef?.value ?? "") : undefined,
      remoteLabel: provider === "local" ? undefined : remoteLabelRef?.value ?? "Google Drive",
      remotePath: provider === "local" ? undefined : remotePathRef?.value ?? "/MiniSync/MeuVault",
    };

    props.onSave(updated);
  });

  footer.append(deleteBtn, saveBtn);

  wrap.append(top, card, footer);
  return wrap;
}
