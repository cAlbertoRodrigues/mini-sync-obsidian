import type { FileHash } from "../ports/file-hasher";

export type FileSyncState = {
  path: string;

  // último estado conhecido que foi "aceito" como sincronizado
  lastSyncedHash?: FileHash;

  // último estado local observado
  lastLocalHash?: FileHash;

  // último estado remoto observado
  lastRemoteHash?: FileHash;

  updatedAtIso: string;
};
