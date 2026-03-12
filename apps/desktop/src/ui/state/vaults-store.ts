import type { VaultProviderId } from "../providers/providers.js";

/**
 * Estados simplificados de sincronização armazenados para um vault na interface.
 */
export type VaultSyncStatus = "idle" | "syncing" | "ok" | "error";

/**
 * Representa uma entrada de log associada a um vault.
 */
export type VaultLogEntry = {
	/**
	 * Timestamp em milissegundos do momento em que a mensagem foi registrada.
	 */
	ts: number;

	/**
	 * Texto descritivo do evento registrado.
	 */
	message: string;
};

/**
 * Representa um vault persistido na interface.
 *
 * Esse tipo reúne os dados necessários para configuração, exibição
 * e acompanhamento do estado de sincronização de um vault.
 */
export type VaultItem = {
	/**
	 * Identificador único do vault.
	 */
	id: string;

	/**
	 * Nome exibido na interface.
	 */
	name: string;

	/**
	 * Provedor de sincronização configurado para o vault.
	 */
	provider: VaultProviderId;

	/**
	 * Caminho local do vault no dispositivo atual.
	 */
	localPath?: string;

	/**
	 * Rótulo amigável do destino remoto exibido na interface.
	 */
	remoteLabel?: string;

	/**
	 * Caminho ou identificador do destino remoto.
	 */
	remotePath?: string;

	/**
	 * Estado atual simplificado da sincronização.
	 */
	status?: VaultSyncStatus;

	/**
	 * Texto amigável exibido na interface para o estado atual.
	 */
	statusText?: string;

	/**
	 * Histórico local de mensagens associadas ao vault.
	 */
	logs?: VaultLogEntry[];
};

/**
 * Chave utilizada para persistir os vaults no `localStorage`.
 */
const KEY = "miniSync.vaults.v1";

/**
 * Normaliza um vault para garantir valores padrão esperados pela interface.
 *
 * @param v Vault a ser normalizado.
 * @returns Vault com campos opcionais preenchidos com valores padrão.
 */
function normalizeVault(v: VaultItem): VaultItem {
	return {
		...v,
		status: v.status ?? "idle",
		statusText: v.statusText ?? "Idle",
		logs: Array.isArray(v.logs) ? v.logs : [],
	};
}

/**
 * Carrega todos os vaults persistidos no `localStorage`.
 *
 * Caso o conteúdo salvo esteja ausente, inválido ou corrompido,
 * a função retorna uma lista vazia.
 *
 * @returns Lista de vaults normalizados.
 */
export function loadVaults(): VaultItem[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return (parsed as VaultItem[]).map(normalizeVault);
	} catch {
		return [];
	}
}

/**
 * Persiste a lista completa de vaults no `localStorage`.
 *
 * @param vaults Lista de vaults a ser salva.
 */
export function saveVaults(vaults: VaultItem[]) {
	localStorage.setItem(KEY, JSON.stringify(vaults));
}

/**
 * Insere ou atualiza um vault na coleção persistida.
 *
 * Se já existir um vault com o mesmo `id`, ele será substituído.
 * Caso contrário, um novo item será adicionado.
 *
 * @param vault Vault a ser inserido ou atualizado.
 */
export function upsertVault(vault: VaultItem) {
	const list = loadVaults();
	const idx = list.findIndex((v) => v.id === vault.id);

	const next = normalizeVault(vault);
	if (idx >= 0) list[idx] = next;
	else list.push(next);

	saveVaults(list);
}

/**
 * Remove um vault persistido pelo seu identificador.
 *
 * @param vaultId Identificador do vault a ser removido.
 */
export function deleteVault(vaultId: string) {
	const list = loadVaults().filter((v) => v.id !== vaultId);
	saveVaults(list);
}

/**
 * Adiciona uma nova entrada de log ao vault informado.
 *
 * Caso o vault não exista, nenhuma alteração é realizada.
 *
 * @param vaultId Identificador do vault.
 * @param message Mensagem a ser registrada no histórico local.
 */
export function appendVaultLog(vaultId: string, message: string) {
	const list = loadVaults();
	const idx = list.findIndex((v) => v.id === vaultId);
	if (idx < 0) return;

	const v = normalizeVault(list[idx]);
	const entry: VaultLogEntry = { ts: Date.now(), message };

	v.logs = [...(v.logs ?? []), entry];
	list[idx] = v;
	saveVaults(list);
}

/**
 * Atualiza o status de sincronização de um vault persistido.
 *
 * Caso o vault não exista, nenhuma alteração é realizada.
 *
 * @param vaultId Identificador do vault.
 * @param status Novo estado simplificado de sincronização.
 * @param statusText Texto opcional exibido na interface para o novo estado.
 */
export function setVaultStatus(
	vaultId: string,
	status: VaultSyncStatus,
	statusText?: string,
) {
	const list = loadVaults();
	const idx = list.findIndex((v) => v.id === vaultId);
	if (idx < 0) return;

	const v = normalizeVault(list[idx]);
	v.status = status;
	v.statusText = statusText ?? v.statusText ?? "Idle";
	list[idx] = v;
	saveVaults(list);
}

/**
 * Gera um identificador curto para novos vaults.
 *
 * @returns Identificador textual pseudoaleatório.
 */
export function createId(): string {
	return Math.random().toString(36).slice(2, 10);
}
