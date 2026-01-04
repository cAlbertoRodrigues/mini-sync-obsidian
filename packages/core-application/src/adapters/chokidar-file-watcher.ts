import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import path from "path";
import {
  FileWatcher,
  FileWatcherOptions,
  FileChangeEvent,
  FileChangeType,
} from "../ports/file-watcher";

export class ChokidarFileWatcher implements FileWatcher {
  private watcher: FSWatcher | null = null;
  private handler: ((event: FileChangeEvent) => void) | null = null;

  onEvent(handler: (event: FileChangeEvent) => void): void {
    this.handler = handler;
  }

  async start(options: FileWatcherOptions): Promise<void> {
    if (this.watcher) return;

    const rootDir = path.resolve(options.rootDir);

    this.watcher = chokidar.watch(rootDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50,
      },
      ignored: (p: string) => options.ignore(path.resolve(p)),
    });

    const emit = (type: FileChangeType, filePath: string) => {
      if (!this.handler) return;

      this.handler({
        type,
        path: path.resolve(filePath),
        occurredAt: new Date(),
      });
    };

    this.watcher
      .on("add", (p: string) => emit("created", p))
      .on("change", (p: string) => emit("modified", p))
      .on("unlink", (p: string) => emit("deleted", p));
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.close();
    this.watcher = null;
  }
}
