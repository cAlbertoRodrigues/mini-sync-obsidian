import type { FileHash } from "../ports/file-hasher";

/**
 * Representa o estado de sincronização de um arquivo específico.
 *
 * Esse estado é utilizado pelo mecanismo de diff para determinar
 * se o arquivo está sincronizado, alterado localmente, alterado
 * remotamente ou em conflito.
 */
export type FileSyncState = {
  /**
   * Caminho relativo do arquivo dentro do vault (formato POSIX).
   */
  path: string;

  /**
   * Hash do último estado considerado sincronizado entre local e remoto.
   */
  lastSyncedHash?: FileHash;

  /**
   * Hash do último estado observado no vault local.
   */
  lastLocalHash?: FileHash;

  /**
   * Hash do último estado observado no remoto.
   */
  lastRemoteHash?: FileHash;

  /**
   * Timestamp ISO indicando a última atualização deste estado.
   */
  updatedAtIso: string;
};