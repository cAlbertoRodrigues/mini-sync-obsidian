export type FileHash = string;

export interface FileRecord {
  path: string;
  hash: FileHash;
  size: number;
  mtimeMs: number;
}
