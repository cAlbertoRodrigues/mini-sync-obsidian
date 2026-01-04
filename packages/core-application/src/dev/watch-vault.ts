import fs from "fs/promises";
import path from "path";
import { ChokidarFileWatcher } from "../adapters/chokidar-file-watcher";
import { createObsidianIgnore } from "../adapters/obsidian-ignore";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import type { FileMetadata } from "../value-objects/file-metadata";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { createHistoryEvent } from "../value-objects/history-event";


async function main() {
  const vaultPath = process.argv[2];
  if (!vaultPath) {
    console.error("Uso: pnpm dev:watch -- <caminho-do-vault>");
    process.exit(1);
  }

  
  const historyRepo = new NodeHistoryRepository();


  const vaultAbs = path.resolve(vaultPath);
  const watcher = new ChokidarFileWatcher();
  const hasher = new NodeFileHasher();

  watcher.onEvent(async (e) => {
    const abs = path.resolve(e.path);
    const rel = path.relative(vaultAbs, abs).replaceAll("\\", "/");

    const meta: FileMetadata = {
      path: rel,
      absolutePath: abs,
      changeType: e.type,
      occurredAt: e.occurredAt,
    };

    if (e.type !== "deleted") {
      try {
        const stat = await fs.stat(abs);
        meta.sizeBytes = stat.size;
        meta.mtimeMs = stat.mtimeMs;

        meta.hash = await hasher.hashFile(abs);
      } catch (err) {
        console.error("Falha ao ler/hash:", abs, err);
      }
    }

    const event = createHistoryEvent(meta, "local");
    await historyRepo.append(vaultAbs, event);

    console.log(
      `[${meta.occurredAt.toISOString()}] ${meta.changeType}: ${meta.path}` +
        (meta.hash ? ` sha256=${meta.hash.value.slice(0, 12)}...` : "")
    );
  });

  await watcher.start({
    rootDir: vaultAbs,
    ignore: createObsidianIgnore(vaultAbs),
  });

  console.log("Watching:", vaultAbs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
