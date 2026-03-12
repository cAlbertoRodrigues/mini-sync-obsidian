import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";

/**
 * Cursor utilizado para sincronização incremental de eventos.
 */
export type SyncCursor = {
  /**
   * Valor opaco que representa a posição atual na sequência de eventos.
   */
  value: string;
};

/**
 * Identificador de um blob armazenado remotamente.
 */
export type BlobKey = {
  /**
   * Hash SHA-256 que identifica o conteúdo do blob.
   */
  sha256: string;
};

/**
 * Identificador de um snapshot.
 */
export type SnapshotKey = {
  /**
   * Identificador único do snapshot.
   */
  id: string;
};

/**
 * Define o contrato de um provedor de sincronização.
 *
 * Implementações podem usar diferentes backends, como:
 * - Google Drive
 * - diretórios compartilhados
 * - serviços de armazenamento remoto
 */
export interface SyncProvider {
  /**
   * Envia eventos de histórico para o backend remoto.
   *
   * @param events Eventos de histórico a serem enviados.
   */
  pushHistoryEvents(events: HistoryEvent[]): Promise<void>;

  /**
   * Obtém eventos remotos a partir de um cursor incremental.
   *
   * @param cursor Cursor da última sincronização conhecida.
   * @returns Lista de eventos e o próximo cursor.
   */
  pullHistoryEvents(
    cursor: SyncCursor | null,
  ): Promise<{
    events: HistoryEvent[];
    nextCursor: SyncCursor | null;
  }>;

  /**
   * Verifica se um blob já existe no backend remoto.
   *
   * Utilizado para deduplicação baseada em hash.
   *
   * @param key Identificador do blob.
   */
  hasBlob(key: BlobKey): Promise<boolean>;

  /**
   * Armazena um blob no backend remoto.
   *
   * @param key Identificador do blob.
   * @param data Conteúdo binário do blob.
   */
  putBlob(key: BlobKey, data: Buffer): Promise<void>;

  /**
   * Recupera um blob armazenado remotamente.
   *
   * @param key Identificador do blob.
   * @returns Conteúdo binário do blob.
   */
  getBlob(key: BlobKey): Promise<Buffer>;

  /**
   * Lista snapshots disponíveis no backend remoto.
   *
   * A ordenação é definida pela implementação do provider.
   */
  listSnapshots(): Promise<SnapshotKey[]>;

  /**
   * Armazena o manifesto de um snapshot.
   *
   * @param key Identificador do snapshot.
   * @param manifest Manifesto contendo metadados do snapshot.
   */
  putSnapshotManifest(
    key: SnapshotKey,
    manifest: SnapshotManifest,
  ): Promise<void>;

  /**
   * Recupera o manifesto de um snapshot específico.
   *
   * @param key Identificador do snapshot.
   * @returns Manifesto do snapshot.
   */
  getSnapshotManifest(key: SnapshotKey): Promise<SnapshotManifest>;
}