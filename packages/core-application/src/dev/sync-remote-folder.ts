import path from "path";
import fs from "fs/promises";
import { RemoteFolderSyncProvider } from "../adapters/remote-folder-sync-provider";
import type { HistoryEvent } from "../value-objects/history-event";
import { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import { VaultEventApplier } from "../adapters/vault-event-applier";
import { setApplyLock, clearApplyLock } from "../adapters/apply-lock";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { FileHash } from "../ports/file-hasher";


async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function warnIfProbablyWrongVaultPath(vaultAbs: string) {
  const obsidianHere = await exists(path.join(vaultAbs, ".obsidian"));
  if (obsidianHere) return;

  // se não tem .obsidian aqui, talvez seja vault novo OU pasta pai
  // tenta achar um vault 1 nível abaixo
  try {
    const children = await fs.readdir(vaultAbs, { withFileTypes: true });
    const candidates = children.filter((d) => d.isDirectory()).map((d) => d.name);

    for (const name of candidates) {
      const candidate = path.join(vaultAbs, name);
      if (await exists(path.join(candidate, ".obsidian"))) {
        console.warn(
          `Atenção: não encontrei ".obsidian" em "${vaultAbs}". ` +
            `Mas encontrei um vault em "${candidate}". ` +
            `Talvez você queira usar esse caminho.`
        );
        return;
      }
    }
  } catch {
    // ignorar
  }

  console.warn(
    `Aviso: não encontrei ".obsidian" em "${vaultAbs}". ` +
      `Se este for um vault novo, tudo bem.`
  );
}


async function main() {
  const localVault = process.argv[2];
  const remoteRoot = process.argv[3];

  if (!localVault || !remoteRoot) {
    console.error('Uso: pnpm dev:sync-remote -- "<vaultLocal>" "<pastaRemota>"');
    process.exit(1);
  }

  const vaultAbs = path.resolve(localVault);
  const remoteAbs = path.resolve(remoteRoot);

  await warnIfProbablyWrongVaultPath(vaultAbs);

  const provider = new RemoteFolderSyncProvider(remoteAbs);
  const cursorStore = new NodeRemoteCursorStore();
  const applier = new VaultEventApplier();

  const stateStore = new NodeSyncStateStore();

  // helpers (precisam estar ANTES do uso)
  const nowIso = () => new Date().toISOString();

  function pickHashFromEvent(e: HistoryEvent): FileHash | undefined {
    return e?.change?.hash;
  }

  async function upsertStatePatch(
  patch: Partial<FileSyncState> & { path: string }
) {
  const prev = await stateStore.get(vaultAbs, patch.path);

  const merged: FileSyncState = {
    lastSyncedHash: prev?.lastSyncedHash,
    lastLocalHash: prev?.lastLocalHash,
    lastRemoteHash: prev?.lastRemoteHash,
    ...patch,
    updatedAtIso: nowIso(),
  };

  await stateStore.upsert(vaultAbs, merged);
}



  // =========
  // 1) Ler histórico local (se existir)
  // =========
  const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");

  let files: string[] = [];
  try {
    files = (await fs.readdir(localHistoryDir))
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
  } catch {
    // Vault novo: sem histórico local ainda -> tudo bem
    files = [];
  }

  const allEvents: HistoryEvent[] = [];

  for (const f of files) {
    const content = await fs.readFile(path.join(localHistoryDir, f), "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const l of lines) allEvents.push(JSON.parse(l) as HistoryEvent);
  }

  console.log("Eventos locais encontrados:", allEvents.length);

  // =========
  // 2) Dedupe + Push (local -> remoto)
  // =========
  const { events: remoteAll } = await provider.pullHistoryEvents(null);
  const remoteIds = new Set(remoteAll.map((e) => e.id));

  const toPush = allEvents.filter((e) => !remoteIds.has(e.id));
  await provider.pushHistoryEvents(toPush);

  // Atualiza state: local observado
  for (const ev of toPush) {
    const h = pickHashFromEvent(ev);
    if (!h) continue; // deleted não tem hash
    await upsertStatePatch({
      path: ev.change.path,
      lastLocalHash: h,
    });
  }

  console.log("Push OK:", toPush.length, "novos eventos enviados. Agora pull incremental...");

  // =========
  // 3) Pull incremental (remoto -> local)
  // =========
  const cursor = await cursorStore.load(vaultAbs);
  console.log("Pull a partir do cursor:", cursor?.value ?? "null");

  const { events: pulled, nextCursor } = await provider.pullHistoryEvents(cursor);
  console.log("Pulled:", pulled.length, "nextCursor:", nextCursor?.value);

  // Atualiza state: remoto observado
  for (const ev of pulled) {
    const h = pickHashFromEvent(ev);
    if (!h) continue;
    await upsertStatePatch({
      path: ev.change.path,
      lastRemoteHash: h,
    });
  }

  await cursorStore.save(vaultAbs, nextCursor ?? cursor);

  // =========
  // 4) Aplicar no vault (com lock) + marcar como synced
  // =========
  if (pulled.length > 0) {
    await setApplyLock(vaultAbs);
    try {
      await applier.apply(vaultAbs, pulled);
    } finally {
      await clearApplyLock(vaultAbs);
    }

    for (const ev of pulled) {
      const h = pickHashFromEvent(ev);
      if (!h) continue;

      await upsertStatePatch({
        path: ev.change.path,
        lastSyncedHash: h,
        lastLocalHash: h, // acabou de aplicar, local vira essa versão
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
