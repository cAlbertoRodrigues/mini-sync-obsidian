import path from "path";
import fs from "fs/promises";

import { RemoteFolderSyncProvider } from "../adapters/remote-folder-sync-provider";
import { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import { VaultEventApplier } from "../adapters/vault-event-applier";
import { setApplyLock, clearApplyLock } from "../adapters/apply-lock";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { NodeConflictDecisionStore } from "../adapters/node-conflict-decision-store";

import type { HistoryEvent } from "../value-objects/history-event";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { FileHash } from "../ports/file-hasher";
import type { ConflictResolutionStrategy } from "../ports/conflict-decision-store";

import { compareAllStates } from "../services/sync-diff";
import { resolveKeepLocal } from "../services/keep-local";
import { resolveKeepRemote } from "../services/keep-remote";

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

function pickHashFromEvent(e: HistoryEvent): FileHash | undefined {
  return e?.change?.hash;
}

async function main() {
  const localVault = process.argv[2];
  const remoteRoot = process.argv[3];
  const strategyArg = (process.argv[4] ?? "local").toLowerCase();

  if (!localVault || !remoteRoot) {
    console.error(
      'Uso: pnpm dev:sync-remote -- "<vaultLocal>" "<pastaRemota>" [local|remote]'
    );
    process.exit(1);
  }

  const strategy: ConflictResolutionStrategy =
    strategyArg === "remote" ? "remote" : "local";

  const vaultAbs = path.resolve(localVault);
  const remoteAbs = path.resolve(remoteRoot);

  await warnIfProbablyWrongVaultPath(vaultAbs);

  const provider = new RemoteFolderSyncProvider(remoteAbs);
  const cursorStore = new NodeRemoteCursorStore();
  const applier = new VaultEventApplier();
  const hasher = new NodeFileHasher();
  const stateStore = new NodeSyncStateStore();
  const historyRepository = new NodeHistoryRepository();
  const decisionStore = new NodeConflictDecisionStore();

  const nowIso = () => new Date().toISOString();

  async function upsertStatePatch(patch: Partial<FileSyncState> & { path: string }) {
    const prev = await stateStore.get(vaultAbs, patch.path);

    const merged: FileSyncState = {
      lastSyncedHash: prev?.lastSyncedHash,
      lastLocalHash: prev?.lastLocalHash,
      lastRemoteHash: prev?.lastRemoteHash,
      updatedAtIso: nowIso(),
      ...patch, // patch já tem path
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

  // Atualiza state: local observado (para os eventos que você acabou de enviar)
  for (const ev of toPush) {
    const h = pickHashFromEvent(ev);
    if (!h) continue;
    await upsertStatePatch({
      path: ev.change.path,
      lastLocalHash: h,
    });
  }

  console.log("Push OK:", toPush.length, "novos eventos enviados.");

  // =========
  // 3) Pull incremental (remoto -> local)
  // =========
  const cursor = await cursorStore.load(vaultAbs);
  console.log("Pull a partir do cursor:", cursor?.value ?? "null");

  const { events: pulled, nextCursor } = await provider.pullHistoryEvents(cursor);
  console.log("Pulled:", pulled.length, "nextCursor:", nextCursor?.value ?? "null");

  // Atualiza state: remoto observado (antes de resolver conflitos)
  for (const ev of pulled) {
    const h = pickHashFromEvent(ev);
    if (!h) continue;
    await upsertStatePatch({
      path: ev.change.path,
      lastRemoteHash: h,
    });
  }
  // =========
  // 4) Detectar conflitos e resolver estratégia (com memória)
  // =========
  const allStatesBefore = await stateStore.loadAll(vaultAbs);
  const { conflicts: conflictsBefore, comparisons } = compareAllStates(allStatesBefore);

  console.log("Resumo (antes da resolução):", {
    total: comparisons.length,
    conflicts: conflictsBefore.length,
    localChanged: comparisons.filter((c) => c.status === "local_changed").length,
    remoteChanged: comparisons.filter((c) => c.status === "remote_changed").length,
    synced: comparisons.filter((c) => c.status === "synced").length,
  });

  if (conflictsBefore.length > 0) {
    console.log(
      `⚠️ Conflitos detectados (${conflictsBefore.length}). Estratégia padrão (CLI): manter ${strategy}.`
    );

    for (const c of conflictsBefore) {
      const rel = c.path.replaceAll("\\", "/");

      const saved = await decisionStore.get(vaultAbs, rel);
      const chosen: ConflictResolutionStrategy = saved?.strategy ?? strategy;

      // registra (ou atualiza) a decisão
      await decisionStore.set(vaultAbs, {
        path: rel,
        strategy: chosen,
        decidedAtIso: new Date().toISOString(),
      });

      if (chosen === "local") {
        await resolveKeepLocal({
          vaultRootAbs: vaultAbs,
          conflicts: [c],
          hasher,
          provider,
          historyRepository,
          stateStore,
        });
      } else {
        await resolveKeepRemote({
          vaultRootAbs: vaultAbs,
          conflicts: [c],
          pulledRemoteEvents: remoteAll,
          hasher,
          historyRepository,
          stateStore,
        });
      }

      console.log(`✅ Conflito resolvido (${rel}) com estratégia: ${chosen}`);
    }
  }

  // ✅ recarrega estado e recalcula conflitos para filtrar apply com base no estado atual
  const statesAfterResolution = await stateStore.loadAll(vaultAbs);
  const { conflicts: conflictsAfterResolution } = compareAllStates(statesAfterResolution);
  const conflictPaths = new Set(conflictsAfterResolution.map((c) => c.path));

  // =========
  // 5) Aplicar eventos remotos no vault (com lock)
  //    IMPORTANTE: não aplicar paths ainda conflitados
  // =========
  const toApply = pulled.filter((ev) => !conflictPaths.has(ev.change.path));

  if (toApply.length > 0) {
    await setApplyLock(vaultAbs);
    try {
      await applier.apply(vaultAbs, toApply);
    } finally {
      await clearApplyLock(vaultAbs);
    }

    // Marcar como synced após aplicar
    for (const ev of toApply) {
      const h = pickHashFromEvent(ev);
      if (!h) continue;

      await upsertStatePatch({
        path: ev.change.path,
        lastSyncedHash: h,
        lastLocalHash: h,
      });
    }
  }

  // =========
  // 6) Salvar cursor
  // =========
  await cursorStore.save(vaultAbs, nextCursor ?? cursor);

  // =========
  // 7) Resumo final
  // =========
  const allStatesAfter = await stateStore.loadAll(vaultAbs);
  const { conflicts: conflictsAfter, comparisons: comparisonsAfter } =
    compareAllStates(allStatesAfter);

  console.log("Resumo (final):", {
    total: comparisonsAfter.length,
    conflicts: conflictsAfter.length,
    localChanged: comparisonsAfter.filter((c) => c.status === "local_changed").length,
    remoteChanged: comparisonsAfter.filter((c) => c.status === "remote_changed").length,
    synced: comparisonsAfter.filter((c) => c.status === "synced").length,
  });

  if (conflictsAfter.length > 0) {
    console.log("⚠️ Conflitos restantes:");
    for (const c of conflictsAfter) console.log(`- ${c.path} [${c.type}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
