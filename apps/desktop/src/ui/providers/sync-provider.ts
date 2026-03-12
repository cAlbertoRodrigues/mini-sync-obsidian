import type { ChangeRow } from "../models/changes.js";
import type { SyncStatusPayload } from "../models/sync.js";
import { setVaultSyncState } from "../state/sync-status-store.js";

/**
 * Parâmetros necessários para executar uma sincronização manual.
 */
type RunSyncArgs = {
	/**
	 * Identificador do vault que será sincronizado.
	 */
	vaultId: string;

	/**
	 * Diretório raiz remoto utilizado no modo de sincronização por pasta.
	 */
	remoteRootDir: string;

	/**
	 * Estratégia padrão para resolução automática de conflitos.
	 *
	 * - `local` → prioriza a versão local
	 * - `remote` → prioriza a versão remota
	 */
	defaultStrategy?: "local" | "remote";
};

/**
 * Executa manualmente a sincronização de um vault.
 *
 * Antes de iniciar a chamada ao processo principal, a função atualiza o store
 * local para refletir o estado `syncing`.
 *
 * @param args Configuração da sincronização manual.
 * @returns Resultado retornado pelo processo principal com o resumo da operação.
 */
export async function runSyncNow(args: RunSyncArgs) {
	const { vaultId } = args;

	setVaultSyncState(vaultId, {
		status: "syncing",
		lastAtIso: new Date().toISOString(),
		lastError: undefined,
	});

	return await window.api.invoke<{ ok: true; summary: unknown }>("sync:run", {
		vaultId,
		mode: "remote-folder",
		remoteRootDir: args.remoteRootDir,
		defaultStrategy: args.defaultStrategy ?? "local",
	});
}

/**
 * Carrega a lista de alterações detectadas para um vault.
 *
 * @param vaultId Identificador do vault consultado.
 * @returns Lista de alterações utilizadas pela interface.
 */
export async function loadChanges(vaultId: string): Promise<ChangeRow[]> {
	return await window.api.invoke<ChangeRow[]>("changes:list", { vaultId });
}

/**
 * Inscreve a interface para receber eventos de status de sincronização
 * emitidos pelo processo principal.
 *
 * Sempre que um novo evento é recebido, o store local é atualizado para manter
 * a interface em sincronia com o estado real da operação.
 *
 * @param onUpdate Callback opcional executado após o processamento de cada evento.
 * @returns Função de unsubscribe retornada pela bridge da API.
 */
export function subscribeSyncStatus(onUpdate?: (p: SyncStatusPayload) => void) {
	return window.api.on<SyncStatusPayload>(
		"sync:status",
		(p: SyncStatusPayload) => {
			if (p.status === "syncing") {
				setVaultSyncState(p.vaultId, {
					status: "syncing",
					lastAtIso: p.atIso,
					lastError: undefined,
				});
			} else if (p.status === "ok") {
				setVaultSyncState(p.vaultId, {
					status: "ok",
					lastAtIso: p.atIso,
					lastError: undefined,
				});
			} else if (p.status === "conflict") {
				setVaultSyncState(p.vaultId, {
					status: "conflict",
					lastAtIso: p.atIso,
					lastError: undefined,
				});
			} else if (p.status === "error") {
				setVaultSyncState(p.vaultId, {
					status: "error",
					lastAtIso: p.atIso,
					lastError: p.error,
				});
			}

			onUpdate?.(p);
		},
	);
}
