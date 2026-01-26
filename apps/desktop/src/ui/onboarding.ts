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

  // remoto
  remoteLabel?: string; // ex: "GoogleDrive", "GitHub", "S3"
  remotePath?: string; // ex: "/Apps/MiniSync/vaultA"
};

type ScreenKind = "home" | "setup";

export function mountOnboarding(root: HTMLElement) {
  // mock inicial (depois você troca pela leitura real do disco/config)
  const vaults: VaultItem[] = [
    { id: "a", name: "Vault A", provider: "local", localPath: "C:\\Ambiente" },
    {
      id: "b",
      name: "Vault B",
      provider: "google-drive",
      remoteLabel: "GoogleDrive",
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
    // sidebar sempre existe
    sidebar.replaceChildren(
      ...renderVaultList({
        vaults,
        selectedVaultId,
        onSelectVault: (id) => goSetup(id),

        onAddVault: () => {
          // depois liga no dialog nativo via preload (openDirectory)
          console.log("Add vault");
        },

        onOpenSettings: () => {
          console.log("Open settings");
        },
      })
    );

    // HOME
    if (screenKind === "home") {
      main.replaceChildren(renderHomeMain());
      return;
    }

    // SETUP
    const vaultId = undefinedSafeSelected(selectedVaultId);
    const vault = vaults.find((v) => v.id === vaultId);

    if (!vault) {
      // se der ruim (vault apagado etc), volta pra home
      main.replaceChildren(renderHomeMain());
      screenKind = "home";
      selectedVaultId = vaults[0]?.id ?? null;
      return;
    }

    main.replaceChildren(
      renderVaultSetupView({
        vault,
        onBack: () => goHome(),
        onContinue: () => {
          // aqui será: “aplicar config + abrir Obsidian”
          console.log("Continuar -> abrir Obsidian com config", vault);
        },
      })
    );
  }

  render();
}

function renderHomeMain(): HTMLElement {
  const wrap = el("div", { className: "ms-center" });

  const icon = el("img", {
    className: "ms-logo",
    // ajuste conforme seu path real (ex: /assets/.. ou ../assets/..)
    src: "./assets/mini-sync-icon-green-keep-border.png",
    alt: "Mini Sync",
  });

  const title = el("h1", { className: "ms-title", textContent: "Mini Sync" });
  const subtitle = el("p", {
    className: "ms-subtitle",
    textContent: "Sincronize seus vaults com segurança antes de abrir o Obsidian.",
  });

  wrap.append(icon, title, subtitle);
  return wrap;
}

/**
 * Garante que o selectedVaultId existe (ou joga erro claro no dev).
 * Evita TS ficar te infernizando com null em todo lugar.
 */
function undefinedSafeSelected(id: string | null): string {
  if (!id) throw new Error("Mini Sync: selectedVaultId é null");
  return id;
}
