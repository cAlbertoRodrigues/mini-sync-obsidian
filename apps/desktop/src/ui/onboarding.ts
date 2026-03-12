import {
	createId,
	deleteVault,
	loadVaults,
	upsertVault,
	type VaultItem,
} from "./state/vaults-store.js";
import { el } from "./utils/dom.js";
import { renderVaultList } from "./views/vault-list-view.js";
import { renderVaultSetupView } from "./views/vault-setup-view.js";

/**
 * Telas disponíveis no fluxo de onboarding.
 */
type ScreenKind = "home" | "setup";

/**
 * Monta a experiência inicial de onboarding do aplicativo.
 *
 * O onboarding controla:
 * - criação do layout principal
 * - seleção e persistência de vaults
 * - navegação entre tela inicial e tela de configuração
 *
 * @param root Elemento raiz onde a interface será montada.
 */
export function mountOnboarding(root: HTMLElement) {
	let screenKind: ScreenKind = "home";

	let vaults: VaultItem[] = loadVaults();

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

	/**
	 * Recarrega os vaults persistidos e garante que a seleção atual
	 * continue válida.
	 */
	function refreshVaults() {
		vaults = loadVaults();
		if (!selectedVaultId && vaults[0]) selectedVaultId = vaults[0].id;
		if (selectedVaultId && !vaults.some((v) => v.id === selectedVaultId)) {
			selectedVaultId = vaults[0]?.id ?? null;
		}
	}

	/**
	 * Navega para a tela inicial do onboarding.
	 */
	function goHome() {
		screenKind = "home";
		render();
	}

	/**
	 * Navega para a tela de configuração do vault informado.
	 *
	 * @param vaultId Identificador do vault a ser configurado.
	 */
	function goSetup(vaultId: string) {
		selectedVaultId = vaultId;
		screenKind = "setup";
		render();
	}

	/**
	 * Cria um novo vault com configuração inicial padrão
	 * e abre sua tela de configuração.
	 */
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

	/**
	 * Renderiza a interface principal do onboarding de acordo
	 * com a tela atualmente ativa.
	 */
	function render() {
		refreshVaults();

		sidebar.replaceChildren(
			...renderVaultList({
				vaults,
				selectedVaultId,
				onSelectVault: (id: string) => goSetup(id),
				onAddVault: () => addVault(),
				onOpenSettings: () => console.log("Open settings (TODO)"),
			}),
		);

		if (screenKind === "home") {
			main.replaceChildren(renderHomeMain());
			return;
		}

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
			}),
		);
	}

	/**
	 * Renderiza a tela inicial do onboarding.
	 *
	 * A tela apresenta a identidade visual do aplicativo e
	 * as ações principais disponíveis para o usuário.
	 *
	 * @returns Elemento HTML da tela inicial.
	 */
	function renderHomeMain() {
		const page = el("div", { className: "ms-home" });

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

		const actions = el("div", { className: "ms-actions" });

		actions.append(
			actionCard({
				title: "Create new vault",
				subtitle: "Create a new Obsidian vault under a folder.",
				buttonLabel: "Create",
				kind: "primary",
				onClick: () => {
					addVault();
				},
			}),
			actionCard({
				title: "Open folder as vault",
				subtitle: "Choose an existing folder of Markdown files.",
				buttonLabel: "Open",
				kind: "default",
				onClick: () => {
					console.log("Open folder (TODO)");
				},
			}),
			actionCard({
				title: "Open vault from Mini Sync",
				subtitle: "Set up a synced vault with an existing remote vault.",
				buttonLabel: "Setup",
				kind: "default",
				onClick: () => {
					addVault();
				},
			}),
		);

		page.append(brand, actions);
		return page;
	}

	render();

	/**
	 * Garante que exista um vault selecionado antes de acessar
	 * fluxos que dependem dessa informação.
	 *
	 * @param id Identificador atualmente selecionado.
	 * @returns Identificador validado.
	 * @throws Error Quando não existe vault selecionado.
	 */
	function requireSelected(id: string | null): string {
		if (!id) throw new Error("Mini Sync: selectedVaultId é null");
		return id;
	}
}

/**
 * Variações visuais disponíveis para os cards de ação.
 */
type ActionKind = "primary" | "default";

/**
 * Cria um card de ação utilizado na tela inicial do onboarding.
 *
 * @param opts Configuração visual e comportamental do card.
 * @param opts.title Título principal do card.
 * @param opts.subtitle Texto auxiliar exibido abaixo do título.
 * @param opts.buttonLabel Texto exibido no botão de ação.
 * @param opts.kind Variação visual do botão do card.
 * @param opts.onClick Callback executado ao clicar no botão.
 * @returns Elemento HTML representando o card de ação.
 */
function actionCard(opts: {
	title: string;
	subtitle: string;
	buttonLabel: string;
	kind: ActionKind;
	onClick: () => void;
}) {
	const row = el("div", { className: "ms-action" });

	const text = el("div", { className: "ms-action-text" });
	const t = el("div", {
		className: "ms-action-title",
		textContent: opts.title,
	});
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
