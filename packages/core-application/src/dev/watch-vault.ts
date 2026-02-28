import fs from "node:fs/promises";
import path from "node:path";

import { ChokidarFileWatcher } from "../adapters/chokidar-file-watcher";
import { createObsidianIgnore } from "../adapters/obsidian-ignore";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { createHistoryEvent } from "../value-objects/history-event";
import type { FileMetadata } from "../value-objects/file-metadata";
import { NodeBlobStore } from "../adapters/node-blob-store";

function stripOuterQuotes(input: string): string {
  return input.replace(/^"(.*)"$/, "$1");
}

function isInsideVault(relPath: string): boolean {
  return (
    relPath !== "" &&
    !relPath.startsWith("..") &&
    !relPath.startsWith("../") &&
    !path.isAbsolute(relPath)
  );
}

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rawVaultPath = process.argv[2];
  if (!rawVaultPath) {
    console.error("Uso: pnpm dev:watch -- <caminho-do-vault>");
    process.exit(1);
  }

  const vaultPath = stripOuterQuotes(rawVaultPath);
  const vaultAbs = path.resolve(vaultPath);

  const historyRepo = new NodeHistoryRepository();
  const watcher = new ChokidarFileWatcher();
  const hasher = new NodeFileHasher();
  const blobStore = new NodeBlobStore();

  const applyingLockAbs = path.join(vaultAbs, ".mini-sync", "state", "applying.lock");

  let ignoreUntilMs = 0;
  const lastHashByPath = new Map<string, string>();

  const INLINE_TEXT_MAX = 64 * 1024; // 64KB

  function isProbablyText(rel: string) {
    const l = rel.toLowerCase();
    return (
      l.endsWith(".md") ||
      l.endsWith(".txt") ||
      l.endsWith(".json") ||
      l.endsWith(".yml") ||
      l.endsWith(".yaml")
    );
  }

  watcher.onEvent(async (e) => {
    const now = Date.now();

    if (await exists(applyingLockAbs)) {
      ignoreUntilMs = Math.max(ignoreUntilMs, now + 1500);
      return;
    }
    if (now < ignoreUntilMs) return;

    const abs = path.isAbsolute(e.path) ? e.path : path.join(vaultAbs, e.path);

    const rel = path.relative(vaultAbs, abs).replaceAll("\\", "/");
    if (!isInsideVault(rel)) return;

    if (rel.startsWith(".mini-sync/") || rel === ".mini-sync") return;
    if (rel.startsWith(".obsidian/") || rel === ".obsidian") return;

    const meta: FileMetadata = {
      path: rel,
      absolutePath: abs,
      changeType: e.type,
      occurredAt: e.occurredAt,
    };

    let contentUtf8: string | undefined;
    let blobSha: string | undefined;

    if (e.type !== "deleted") {
      try {
        const stat = await fs.stat(abs);
        meta.sizeBytes = stat.size;
        meta.mtimeMs = stat.mtimeMs;

        meta.hash = await hasher.hashFile(abs);

        if (e.type === "modified" && meta.hash?.value) {
          const prev = lastHashByPath.get(rel);
          if (prev && prev === meta.hash.value) return;
          lastHashByPath.set(rel, meta.hash.value);
        }

        if (meta.hash?.value) {
          const buf = await fs.readFile(abs);

          if (isProbablyText(rel) && buf.byteLength <= INLINE_TEXT_MAX) {
            contentUtf8 = buf.toString("utf-8");
          } else {
            await blobStore.put(vaultAbs, meta.hash.value, buf);
            blobSha = meta.hash.value;
          }
        }
      } catch (err) {
        console.error("Falha ao ler/stat/hash:", abs, err);
      }
    } else {
      lastHashByPath.delete(rel);
    }

    const event = createHistoryEvent(meta, "local");

    if (contentUtf8 !== undefined) {
      event.contentUtf8 = contentUtf8;
    } else if (blobSha && meta.sizeBytes) {
      event.blob = { sha256: blobSha, sizeBytes: meta.sizeBytes };
    }

    await historyRepo.append(vaultAbs, event);

    console.log(
      `[${meta.occurredAt.toISOString()}] ${meta.changeType}: ${meta.path}` +
        (meta.hash ? ` sha256=${meta.hash.value.slice(0, 12)}...` : "") +
        (event.blob ? ` blob=${event.blob.sha256.slice(0, 12)}...` : "") +
        (event.contentUtf8 !== undefined ? ` inlineText=${event.contentUtf8.length}B` : "")
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