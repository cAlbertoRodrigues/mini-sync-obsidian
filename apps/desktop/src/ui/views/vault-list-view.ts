import type { VaultItem } from "../state/vaults-store.js";
import { el } from "../utils/dom.js";

/**
 * Propriedades necessárias para renderizar a lista lateral de vaults.
 */
type Props = {
	/**
	 * Lista de vaults disponíveis na interface.
	 */
	vaults: VaultItem[];

	/**
	 * Identificador do vault atualmente selecionado.
	 */
	selectedVaultId: string | null;

	/**
	 * Callback executado quando o usuário seleciona um vault.
	 */
	onSelectVault: (id: string) => void;

	/**
	 * Callback executado ao solicitar a criação de um novo vault.
	 */
	onAddVault: () => void;

	/**
	 * Callback executado ao abrir as configurações.
	 */
	onOpenSettings: () => void;
};

/**
 * Retorna a classe CSS correspondente ao status atual do vault.
 *
 * @param status Estado simplificado de sincronização do vault.
 * @returns Classe CSS usada para exibir o indicador visual de status.
 */
function statusClass(status?: VaultItem["status"]) {
	switch (status) {
		case "syncing":
			return "ms-status ms-status--syncing";
		case "ok":
			return "ms-status ms-status--ok";
		case "error":
			return "ms-status ms-status--error";
		default:
			return "ms-status ms-status--idle";
	}
}

/**
 * Renderiza a lista lateral de vaults da aplicação.
 *
 * @param props Propriedades usadas para construir a interface.
 * @returns Elementos HTML da view prontos para inserção no DOM.
 */
export function renderVaultList(props: Props): HTMLElement[] {
	const header = el("div", { className: "ms-sidebar-header" });
	header.append(
		el("div", { className: "ms-sidebar-title", textContent: "VAULTS" }),
	);

	const actions = el("div", { className: "ms-sidebar-actions" });

	const addBtn = el("button", {
		className: "ms-icon-btn",
		title: "Adicionar vault",
	});
	addBtn.textContent = "+";
	addBtn.addEventListener("click", props.onAddVault);

	const settingsBtn = el("button", {
		className: "ms-icon-btn",
		title: "Configurações",
	});
	settingsBtn.textContent = "⚙";
	settingsBtn.addEventListener("click", props.onOpenSettings);

	actions.append(addBtn, settingsBtn);
	header.append(actions);

	const list = el("div", { className: "ms-vault-list" });

	for (const v of props.vaults) {
		const row = el("button", {
			className: `ms-vault-item${props.selectedVaultId === v.id ? " is-active" : ""}`,
		});

		const nameRow = el("div", { className: "ms-vault-name-row" });
		nameRow.append(
			el("span", { className: statusClass(v.status) }),
			el("div", { className: "ms-vault-name", textContent: v.name }),
		);

		let metaText = "";
		if (v.provider === "local") {
			metaText = `Local • ${v.localPath ?? ""}`.trim();
		} else {
			const label = v.remoteLabel ?? "Remoto";
			metaText = `${label}${v.remotePath ? ` • ${v.remotePath}` : ""}`;
		}

		const statusText = v.statusText ? ` • ${v.statusText}` : "";
		const meta = el("div", {
			className: "ms-vault-meta",
			textContent: `${metaText}${statusText}`,
		});

		row.append(nameRow, meta);
		row.addEventListener("click", () => props.onSelectVault(v.id));
		list.append(row);
	}

	return [header, list];
}
