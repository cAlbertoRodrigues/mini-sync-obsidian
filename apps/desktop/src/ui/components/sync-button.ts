import {
	getStatusLabel,
	getVaultSyncState,
} from "../state/sync-status-store.js";

/**
 * Renderiza o botão de sincronização para um vault específico.
 *
 * O componente exibe:
 * - o estado atual da sincronização
 * - um botão para iniciar a sincronização manual
 *
 * O botão é automaticamente desativado enquanto uma sincronização
 * está em andamento (`syncing`).
 *
 * @param opts Configuração para renderização do botão.
 * @param opts.vaultId Identificador do vault cujo estado de sincronização será exibido.
 * @param opts.onClick Função executada quando o usuário solicita uma sincronização.
 * @returns Elemento HTML contendo o status atual e o botão de sincronização.
 */
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
