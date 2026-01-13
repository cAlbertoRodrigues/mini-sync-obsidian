import fs from "fs/promises";
import path from "path";
import { ChokidarFileWatcher } from "../adapters/chokidar-file-watcher";
import { createObsidianIgnore } from "../adapters/obsidian-ignore";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import type { FileMetadata } from "../value-objects/file-metadata";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { createHistoryEvent } from "../value-objects/history-event";

function stripOuterQuotes(input: string): string {
  // remove apenas 1 par de aspas externas, se existir
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

  // lock usado pelo sync-drive durante apply (e vamos respeitar aqui)
  const applyingLockAbs = path.join(vaultAbs, ".mini-sync", "state", "applying.lock");

  // cooldown para pegar autosave/normalização do Obsidian logo após apply
  let ignoreUntilMs = 0;

  // dedupe rápido: evita modified repetido com mesmo hash (por path)
  const lastHashByPath = new Map<string, string>();

  watcher.onEvent(async (e) => {
    // Se o sync está aplicando (ou acabou de aplicar), não registrar nada
    const now = Date.now();

    // Se lock existe, estende o ignore para logo após o unlock
    if (await exists(applyingLockAbs)) {
      ignoreUntilMs = Math.max(ignoreUntilMs, now + 1500);
      return;
    }
    if (now < ignoreUntilMs) {
      return;
    }

    // e.path já deve ser absoluto (do watcher). Se não for, torna absoluto.
    const abs = path.isAbsolute(e.path) ? e.path : path.join(vaultAbs, e.path);

    // caminho RELATIVO ao vault (isso é o que vai para o histórico)
    const rel = path.relative(vaultAbs, abs).replaceAll("\\", "/");

    // Se por algum motivo o evento estiver fora do vault, ignora
    if (!isInsideVault(rel)) return;

    // Evita loop e sujeira: nunca registrar a pasta interna do mini-sync
    if (rel.startsWith(".mini-sync/") || rel === ".mini-sync") return;

    // Evita ruído do Obsidian (workspace/cache/metadata)
    if (rel.startsWith(".obsidian/") || rel === ".obsidian") return;

    const meta: FileMetadata = {
      path: rel,
      absolutePath: abs,
      changeType: e.type,
      occurredAt: e.occurredAt,
    };

    let metaContent: string | undefined;

    if (e.type !== "deleted") {
      try {
        const stat = await fs.stat(abs);
        meta.sizeBytes = stat.size;
        meta.mtimeMs = stat.mtimeMs;

        // hash do arquivo
        meta.hash = await hasher.hashFile(abs);

        // ✅ dedupe: se modified com mesmo hash do último, ignora
        if (e.type === "modified" && meta.hash?.value) {
          const prev = lastHashByPath.get(rel);
          if (prev && prev === meta.hash.value) {
            return;
          }
          lastHashByPath.set(rel, meta.hash.value);
        }

        // Conteúdo só para markdown (por enquanto)
        if (rel.toLowerCase().endsWith(".md")) {
          metaContent = await fs.readFile(abs, "utf-8");
        }
      } catch (err) {
        console.error("Falha ao ler/stat/hash:", abs, err);
      }
    } else {
      // se deletou, limpa dedupe
      lastHashByPath.delete(rel);
    }

    const event = createHistoryEvent(meta, "local");
    if (metaContent !== undefined) {
      event.content = metaContent;
      event.encoding = "utf-8";
    }

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
