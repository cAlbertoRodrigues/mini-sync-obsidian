import type { FileChangeType } from "../ports/file-watcher";
import type { FileHash } from "../ports/file-hasher";

export type FileMetadata = {
  path: string; 
  absolutePath: string;
  changeType: FileChangeType;
  occurredAt: Date;

  hash?: FileHash;
  sizeBytes?: number;
  mtimeMs?: number;
};
