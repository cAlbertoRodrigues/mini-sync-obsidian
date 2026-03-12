import type {
	ChangeSet,
	Conflict,
	DeviceId,
	SnapshotId,
	VaultId,
} from "@mini-sync/core-domain";

/**
 * Resultado de uma operação de push de mudanças.
 */
export type PushResult =
	| {
			/**
			 * Indica que o push foi aplicado com sucesso.
			 */
			type: "ok";

			/**
			 * Identificador do novo snapshot gerado após aplicar as mudanças.
			 */
			newSnapshotId: SnapshotId;
	  }
	| {
			/**
			 * Indica que houve conflitos ao tentar aplicar o push.
			 */
			type: "conflict";

			/**
			 * Lista de conflitos detectados durante a operação.
			 */
			conflicts: Conflict[];
	  };

/**
 * Define o contrato responsável por transportar mudanças entre dispositivos.
 *
 * Implementações podem usar diferentes mecanismos de comunicação,
 * como APIs HTTP, armazenamento remoto ou diretórios compartilhados.
 */
export interface SyncTransport {
	/**
	 * Envia mudanças locais para o backend remoto.
	 *
	 * @param params Parâmetros necessários para aplicar o push.
	 * @returns Resultado da operação contendo sucesso ou conflitos.
	 */
	pushChanges(params: {
		/**
		 * Identificador do vault.
		 */
		vaultId: VaultId;

		/**
		 * Identificador do dispositivo que está enviando as mudanças.
		 */
		deviceId: DeviceId;

		/**
		 * Snapshot base conhecido pelo dispositivo antes do push.
		 */
		baseSnapshotId: SnapshotId | null;

		/**
		 * Conjunto de mudanças a serem aplicadas.
		 */
		changeSet: ChangeSet;
	}): Promise<PushResult>;

	/**
	 * Obtém mudanças remotas desde o último snapshot conhecido.
	 *
	 * @param params Parâmetros utilizados para recuperar atualizações.
	 * @returns Conjunto de mudanças e o novo snapshot resultante.
	 */
	pullUpdates(params: {
		/**
		 * Identificador do vault.
		 */
		vaultId: VaultId;

		/**
		 * Identificador do dispositivo que solicita as atualizações.
		 */
		deviceId: DeviceId;

		/**
		 * Snapshot mais recente conhecido pelo dispositivo.
		 */
		sinceSnapshotId: SnapshotId | null;
	}): Promise<{
		/**
		 * Conjunto de mudanças detectadas no backend remoto.
		 */
		changeSet: ChangeSet;

		/**
		 * Snapshot atualizado após aplicar as mudanças.
		 */
		newSnapshotId: SnapshotId;
	}>;
}
