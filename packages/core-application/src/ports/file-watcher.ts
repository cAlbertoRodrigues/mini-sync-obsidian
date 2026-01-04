export type FileChangeType = "created" | "modified" | "deleted";

export type FileChangeEvent = {
  type: FileChangeType;
  path: string;
  occurredAt: Date;
};

export type FileWatcherOptions = {
  rootDir: string;
  ignore: (path: string) => boolean;
};

export interface FileWatcher {
  start(options: FileWatcherOptions): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: FileChangeEvent) => void): void;
}

export type FileHash = {
  algorithm: "sha256";
  value: string;
};

export interface FileHasher {
  hashFile(absolutePath: string): Promise<FileHash>;
}
