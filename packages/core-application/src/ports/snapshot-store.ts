import type {
	DeviceId,
	Snapshot,
	SnapshotId,
	VaultId,
} from "@mini-sync/core-domain";

/**
 * Define o contrato responsável por persistir snapshots e controlar
 * o estado de sincronização entre dispositivos.
 */
export interface SnapshotStore {
	/**
	 * Obtém o identificador do último snapshot sincronizado entre
	 * um vault e um dispositivo específico.
	 *
	 * @param vaultId Identificador do vault.
	 * @param deviceId Identificador do dispositivo.
	 * @returns ID do snapshot sincronizado ou `null` quando inexistente.
	 */
	getLastSyncedSnapshotId(
		vaultId: VaultId,
		deviceId: DeviceId,
	): Promise<SnapshotId | null>;

	/**
	 * Persiste um snapshot no armazenamento.
	 *
	 * @param snapshot Snapshot a ser armazenado.
	 */
	saveSnapshot(snapshot: Snapshot): Promise<void>;

	/**
	 * Marca um snapshot como o último sincronizado para um dispositivo.
	 *
	 * @param vaultId Identificador do vault.
	 * @param deviceId Identificador do dispositivo.
	 * @param snapshotId Identificador do snapshot sincronizado.
	 */
	markAsLastSynced(
		vaultId: VaultId,
		deviceId: DeviceId,
		snapshotId: SnapshotId,
	): Promise<void>;
}