export type FileHash = {
  algorithm: "sha256";
  value: string;
};

export interface FileHasher {
  hashFile(absolutePath: string): Promise<FileHash>;
}
