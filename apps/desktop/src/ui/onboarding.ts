import { el } from "./utils/dom.js";
import { renderVaultList } from "./views/vault-list-view.js";
import { renderVaultSetupView } from "./views/vault-setup-view.js";

export type VaultProvider = "local" | "google-drive";

export type VaultItem = {
  id: string;
  name: string;
  provider: VaultProvider;

  // local
  localPath?: string;

  // remote (ex.: google drive)
  remoteLabel?: string;
  remotePath?: string;
};

type ScreenKind = "home" | "setup";

export function mountOnboarding(root: HTMLElement) {
  // Lista estática por enquanto (você troca depois por dados reais)
  const vaults: VaultItem[] = [
    { id: "a", name: "Vault A", provider: "local", localPath: "C:\\Ambiente" },
    {
      id: "b",
      name: "Vault B",
      provider: "google-drive",
      remoteLabel: "Google Drive",
      remotePath: "/MiniSync/VaultB",
    },
  ];

  let screenKind: ScreenKind = "home";
  let selectedVaultId: string | null = vaults[0]?.id ?? null;

  const shell = el("div", { className: "ms-shell" });
  const sidebar = el("aside", { className: "ms-sidebar" });
  const main = el("main", { className: "ms-main" });

  shell.append(sidebar, main);
  root.replaceChildren(shell);

  function goHome() {
    screenKind = "home";
    render();
  }

  function goSetup(vaultId: string) {
    selectedVaultId = vaultId;
    screenKind = "setup";
    render();
  }

  function render() {
    // (1) Sidebar sempre renderizada
    sidebar.replaceChildren(
      ...renderVaultList({
        vaults,
        selectedVaultId,
        onSelectVault: (id) => goSetup(id),
        onAddVault: () => console.log("Add vault (TODO)"),
        onOpenSettings: () => console.log("Open settings (TODO)"),
      })
    );

    // HOME
    if (screenKind === "home") {
      main.replaceChildren(renderHomeMain());
      return;
    }

    // SETUP
    const vaultId = requireSelected(selectedVaultId);
    const vault = vaults.find((v) => v.id === vaultId);

    if (!vault) {
      screenKind = "home";
      selectedVaultId = vaults[0]?.id ?? null;
      main.replaceChildren(renderHomeMain());
      return;
    }

    main.replaceChildren(
      renderVaultSetupView({
        vault,
        onBack: () => goHome(),
        onContinue: () => console.log("Continue (TODO)", vault),
      })
    );
  }

  // (2) + (3)
  function renderHomeMain() {
    const page = el("div", { className: "ms-home" });

    // (2) Brand central: ícone + nome
    const brand = el("div", { className: "ms-brand" });

    const icon = el("img", {
      className: "ms-brand-logo",
      src: "./assets/images/mini-sync-logo.png",
      alt: "Mini Sync",
    });

    const name = el("div", {
      className: "ms-brand-name",
      textContent: "Mini Sync",
    });

    brand.append(icon, name);

    // (3) Cards padrão Obsidian (texto à esquerda + botão à direita)
    const actions = el("div", { className: "ms-actions" });

    actions.append(
      actionCard({
        title: "Create new vault",
        subtitle: "Create a new Obsidian vault under a folder.",
        buttonLabel: "Create",
        kind: "primary",
        onClick: () => console.log("Create new vault"),
      }),
      actionCard({
        title: "Open folder as vault",
        subtitle: "Choose an existing folder of Markdown files.",
        buttonLabel: "Open",
        kind: "default",
        onClick: () => console.log("Open folder"),
      }),
      actionCard({
        title: "Open vault from Mini Sync",
        subtitle: "Set up a synced vault with an existing remote vault.",
        buttonLabel: "Setup",
        kind: "default",
        onClick: () => console.log("Setup remote"),
      })
    );

    page.append(brand, actions);
    return page;
  }

  render();

  function requireSelected(id: string | null): string {
    if (!id) throw new Error("Mini Sync: selectedVaultId é null");
    return id;
  }
}

type ActionKind = "primary" | "default";

function actionCard(opts: {
  title: string;
  subtitle: string;
  buttonLabel: string;
  kind: ActionKind;
  onClick: () => void;
}) {
  const row = el("div", { className: "ms-action" });

  const text = el("div", { className: "ms-action-text" });
  const t = el("div", { className: "ms-action-title", textContent: opts.title });
  const s = el("div", {
    className: "ms-action-subtitle",
    textContent: opts.subtitle,
  });
  text.append(t, s);

  const btn = el("button", {
    className: `ms-btn ${
      opts.kind === "primary" ? "ms-btn--primary" : "ms-btn--default"
    }`,
    textContent: opts.buttonLabel,
  });
  btn.addEventListener("click", opts.onClick);

  row.append(text, btn);
  return row;
}
