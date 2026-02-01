import { el } from "./utils/dom.js";
import { renderVaultList } from "./views/vault-list-view.js";
import { renderVaultSetupView } from "./views/vault-setup-view.js";
import {
  loadVaults,
  upsertVault,
  createId,
  deleteVault,
  type VaultItem,
} from "./state/vaults-store.js";

type ScreenKind = "home" | "setup";

export function mountOnboarding(root: HTMLElement) {
  let screenKind: ScreenKind = "home";

  // estado vindo do storage
  let vaults: VaultItem[] = loadVaults();

  // bootstrap: cria um vault inicial se estiver vazio
  if (vaults.length === 0) {
    const first: VaultItem = {
      id: createId(),
      name: "Meu Vault",
      provider: "local",
      localPath: "",
      status: "idle",
      statusText: "Idle",
    };
    upsertVault(first);
    vaults = loadVaults();
  }

  let selectedVaultId: string | null = vaults[0]?.id ?? null;

  const shell = el("div", { className: "ms-shell" });
  const sidebar = el("aside", { className: "ms-sidebar" });
  const main = el("main", { className: "ms-main" });

  shell.append(sidebar, main);
  root.replaceChildren(shell);

  function refreshVaults() {
    vaults = loadVaults();
    if (!selectedVaultId && vaults[0]) selectedVaultId = vaults[0].id;
    if (selectedVaultId && !vaults.some((v) => v.id === selectedVaultId)) {
      selectedVaultId = vaults[0]?.id ?? null;
    }
  }

  function goHome() {
    screenKind = "home";
    render();
  }

  function goSetup(vaultId: string) {
    selectedVaultId = vaultId;
    screenKind = "setup";
    render();
  }

  function addVault() {
    const v: VaultItem = {
      id: createId(),
      name: "Novo Vault",
      provider: "local",
      localPath: "",
      status: "idle",
      statusText: "Idle",
    };
    upsertVault(v);
    refreshVaults();
    goSetup(v.id);
  }

  function render() {
    refreshVaults();

    // (1) Sidebar sempre renderizada
    sidebar.replaceChildren(
      ...renderVaultList({
        vaults,
        selectedVaultId,
        onSelectVault: (id) => goSetup(id),
        onAddVault: () => addVault(),
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
        onSave: (updatedVault: VaultItem) => {
          upsertVault(updatedVault);
          refreshVaults();
          goHome();
        },
        onDelete: (vaultIdToDelete: string) => {
          deleteVault(vaultIdToDelete);
          refreshVaults();
          goHome();
        },
      })
    );
  } // ✅ FECHA render()

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
        onClick: () => {
          // por enquanto, cria um vault na lista e abre setup
          addVault();
        },
      }),
      actionCard({
        title: "Open folder as vault",
        subtitle: "Choose an existing folder of Markdown files.",
        buttonLabel: "Open",
        kind: "default",
        onClick: () => {
          // MVP: ainda não implementado (vai virar um card futuro)
          console.log("Open folder (TODO)");
        },
      }),
      actionCard({
        title: "Open vault from Mini Sync",
        subtitle: "Set up a synced vault with an existing remote vault.",
        buttonLabel: "Setup",
        kind: "default",
        onClick: () => {
          // MVP: cria vault e deixa o user escolher provider e preencher dados
          addVault();
        },
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
    className: `ms-btn ${opts.kind === "primary" ? "ms-btn--primary" : "ms-btn--default"}`,
    textContent: opts.buttonLabel,
  });
  btn.addEventListener("click", opts.onClick);

  row.append(text, btn);
  return row;
}
