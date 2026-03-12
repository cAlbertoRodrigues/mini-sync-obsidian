import type { ChangeSet, Snapshot, VaultId } from "@mini-sync/core-domain";

/**
 * Define o contrato responsável por interagir com o vault no sistema local.
 *
 * Implementações dessa interface são responsáveis por:
 * - gerar snapshots representando o estado atual do vault
 * - aplicar conjuntos de mudanças recebidos de outros dispositivos
 */
export interface VaultRepository {
	/**
	 * Gera um snapshot do estado atual do vault.
	 *
	 * O snapshot inclui metadados de arquivos como hash, tamanho e
	 * timestamps de modificação.
	 *
	 * @param vaultId Identificador do vault.
	 * @returns Snapshot representando o estado atual do vault.
	 */
	generateSnapshot(vaultId: VaultId): Promise<Snapshot>;

	/**
	 * Aplica um conjunto de mudanças ao vault local.
	 *
	 * O `ChangeSet` pode conter:
	 * - arquivos adicionados
	 * - arquivos modificados
	 * - arquivos removidos
	 *
	 * @param vaultId Identificador do vault.
	 * @param changeSet Conjunto de mudanças a aplicar.
	 */
	applyChangeSet(vaultId: VaultId, changeSet: ChangeSet): Promise<void>;
}
