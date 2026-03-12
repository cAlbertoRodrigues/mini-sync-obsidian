import type { SyncUiStatus } from "../models/sync.js";

/**
 * Estado de sincronização mantido para um vault específico.
 */
type VaultSyncState = {
	/**
	 * Status atual da sincronização exibido na interface.
	 */
	status: SyncUiStatus;

	/**
	 * Momento do último evento de sincronização em formato ISO.
	 */
	lastAtIso?: string;

	/**
	 * Última mensagem de erro registrada durante a sincronização.
	 */
	lastError?: string;
};

/**
 * Armazena o estado de sincronização de cada vault em memória.
 *
 * A chave do mapa é o `vaultId`.
 */
const stateByVault = new Map<string, VaultSyncState>();

/**
 * Obtém o estado atual de sincronização de um vault.
 *
 * Caso ainda não exista estado registrado, retorna o estado padrão `idle`.
 *
 * @param vaultId Identificador do vault.
 * @returns Estado atual da sincronização.
 */
export function getVaultSyncState(vaultId: string): VaultSyncState {
	return stateByVault.get(vaultId) ?? { status: "idle" };
}

/**
 * Atualiza parcialmente o estado de sincronização de um vault.
 *
 * A atualização é feita por *merge* com o estado anterior.
 *
 * @param vaultId Identificador do vault.
 * @param patch Alterações a serem aplicadas ao estado atual.
 */
export function setVaultSyncState(
	vaultId: string,
	patch: Partial<VaultSyncState>,
) {
	const prev = getVaultSyncState(vaultId);
	stateByVault.set(vaultId, { ...prev, ...patch });
}

/**
 * Converte um status interno de sincronização para um rótulo
 * amigável exibido na interface.
 *
 * @param status Estado de sincronização.
 * @returns Texto correspondente exibido na UI.
 */
export function getStatusLabel(status: SyncUiStatus) {
	switch (status) {
		case "idle":
			return "Idle";
		case "syncing":
			return "Syncing...";
		case "ok":
			return "OK";
		case "conflict":
			return "Conflicts";
		case "error":
			return "Error";
	}
}
