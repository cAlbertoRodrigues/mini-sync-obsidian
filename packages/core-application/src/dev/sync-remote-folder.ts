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

import { withRetry } from "../application/with-retry";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { sleep } from "../infra/sleep";

const retryPolicy = defaultNetworkRetryPolicy();

/**
 * Converte hash para string comparável. Suporta:
 * - string
 * - { algorithm, value }
 */
function normalizeHash(h: any): string | undefined {
  if (!h) return undefined;
  if (typeof h === "string") return h;
  if (typeof h === "object" && typeof h.value === "string") return h.value;
  return undefined;
}

/**
 * Se localHash e remoteHash são iguais, então o arquivo está "synced":
 * - lastSyncedHash precisa refletir isso (senão o diff acusa coisas erradas)
 */
function reconcileSynced(state: Partial<FileSyncState>) {
  const lh = normalizeHash((state as any).lastLocalHash);
  const rh = normalizeHash((state as any).lastRemoteHash);

  if (lh && rh && lh === rh) {
    (state as any).lastSyncedHash = (state as any).lastLocalHash;
    return;
  }

  if (!lh && !rh) {
    (state as any).lastSyncedHash = undefined;
  }
}

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
    // ignore
  }

  console.warn(
    `Aviso: não encontrei ".obsidian" em "${vaultAbs}". ` +
      `Se este for um vault novo, tudo bem.`
  );
}

function pickHashFromEvent(e: HistoryEvent): FileHash | undefined {
  return e?.change?.hash;
}

function isDeletedEvent(e: HistoryEvent) {
  return e?.change?.changeType === "deleted";
}

/**
 * Seleciona o ÚLTIMO evento por arquivo (para atualizar hashes corretamente)
 */
function buildLatestByPath(events: HistoryEvent[]): Map<string, HistoryEvent> {
  const sorted = [...events].sort((a, b) => {
    const aa = new Date(a.occurredAtIso).getTime();
    const bb = new Date(b.occurredAtIso).getTime();
    return aa - bb;
  });

  const map = new Map<string, HistoryEvent>();
  for (const e of sorted) map.set(e.change.path, e);
  return map;
}

async function main() {
  const localVault = process.argv[2];
  const remoteRoot = process.argv[3];
  const strategyArg = (process.argv[4] ?? "local").toLowerCase();

  if (!localVault || !remoteRoot) {
    console.error('Uso: pnpm dev:sync-remote -- "<vaultLocal>" "<pastaRemota>" [local|remote]');
    process.exit(1);
  }

  const strategy: ConflictResolutionStrategy = strategyArg === "remote" ? "remote" : "local";

  const vaultAbs = path.resolve(localVault);
  const remoteAbs = path.resolve(remoteRoot);

  await warnIfProbablyWrongVaultPath(vaultAbs);

  // ✅ NOVO: vaultId para estruturar MiniSync/<vaultId> no remoto
  const vaultIdForRemote = path.basename(vaultAbs);

  // ✅ NOVO: provider agora recebe (remoteRootDir, vaultId)
  const provider = new RemoteFolderSyncProvider(remoteAbs, vaultIdForRemote);

  const cursorStore = new NodeRemoteCursorStore(); // opcional: namespace no futuro
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
      ...patch,
    } as FileSyncState;

    const patchExplicitlySetSynced = Object.prototype.hasOwnProperty.call(patch, "lastSyncedHash");
    if (!patchExplicitlySetSynced) {
      reconcileSynced(merged);
    }

    await stateStore.upsert(vaultAbs, merged);
  }

  /* ------------------------------------------------------------------ */
  /* 1) Read local history (estado local)                                */
  /* ------------------------------------------------------------------ */

  const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");
  let files: string[] = [];
  try {
    files = (await fs.readdir(localHistoryDir)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    files = [];
  }

  const allLocalEvents: HistoryEvent[] = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(localHistoryDir, f), "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const l of lines) {
      try {
        allLocalEvents.push(JSON.parse(l) as HistoryEvent);
      } catch {
        // ignore linha inválida
      }
    }
  }

  console.log("Eventos locais encontrados:", allLocalEvents.length);

  // Atualiza lastLocalHash baseado no ÚLTIMO evento por arquivo
  const latestLocalByPath = buildLatestByPath(allLocalEvents);
  for (const [p, ev] of latestLocalByPath.entries()) {
    if (isDeletedEvent(ev)) {
      await upsertStatePatch({ path: p, lastLocalHash: undefined });
    } else {
      const h = pickHashFromEvent(ev);
      if (h) await upsertStatePatch({ path: p, lastLocalHash: h });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2) PULL FIRST (remote -> local)                                     */
  /* ------------------------------------------------------------------ */

  const cursor = await cursorStore.load(vaultAbs);
  console.log("Pull a partir do cursor:", cursor?.value ?? "null");

  const { events: pulled, nextCursor } = await withRetry(
    () => provider.pullHistoryEvents(cursor),
    retryPolicy,
    sleep
  );

  console.log("Pulled:", pulled.length, "nextCursor:", nextCursor?.value ?? "null");

  // Atualiza lastRemoteHash com base no ÚLTIMO evento remoto por arquivo nesse batch
  const latestRemoteByPath = buildLatestByPath(pulled);
  for (const [p, ev] of latestRemoteByPath.entries()) {
    if (isDeletedEvent(ev)) {
      await upsertStatePatch({ path: p, lastRemoteHash: undefined });
    } else {
      const h = pickHashFromEvent(ev);
      if (h) await upsertStatePatch({ path: p, lastRemoteHash: h });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3) Detect conflicts BEFORE applying remote events                   */
  /* ------------------------------------------------------------------ */

  const allStatesBefore = await stateStore.loadAll(vaultAbs);
  const { conflicts: conflictsBefore, comparisons } = compareAllStates(allStatesBefore);

  console.log("Resumo (antes da resolução):", {
    total: comparisons.length,
    conflicts: conflictsBefore.length,
    localChanged: comparisons.filter((c) => c.status === "local_changed").length,
    remoteChanged: comparisons.filter((c) => c.status === "remote_changed").length,
    synced: comparisons.filter((c) => c.status === "synced").length,
  });

  const remoteAllNowRes = await withRetry(
    () => provider.pullHistoryEvents(null),
    retryPolicy,
    sleep
  );
  const remoteAllNow = remoteAllNowRes.events;

  if (conflictsBefore.length > 0) {
    console.log(
      `⚠️ Conflitos detectados (${conflictsBefore.length}). Estratégia padrão (CLI): manter ${strategy}.`
    );

    for (const c of conflictsBefore) {
      const rel = c.path.replaceAll("\\", "/");

      const saved = await decisionStore.get(vaultAbs, rel);
      const chosen: ConflictResolutionStrategy = saved?.strategy ?? strategy;

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
          pulledRemoteEvents: remoteAllNow, // ✅ aqui é ARRAY de eventos
          hasher,
          historyRepository,
          stateStore,
        });
      }

      console.log(`✅ Conflito resolvido (${rel}) com estratégia: ${chosen}`);
    }
  }

  // Recompute conflicts after resolution (não aplicar eventos remotos desses paths)
  const statesAfterResolution = await stateStore.loadAll(vaultAbs);
  const { conflicts: conflictsAfterResolution } = compareAllStates(statesAfterResolution);
  const conflictPaths = new Set(conflictsAfterResolution.map((c) => c.path));

  /* ------------------------------------------------------------------ */
  /* 4) Apply remote events to the vault (with lock), excluindo conflitos */
  /* ------------------------------------------------------------------ */

  const toApply = pulled.filter((ev) => !conflictPaths.has(ev.change.path));

  if (toApply.length > 0) {
    await setApplyLock(vaultAbs);
    try {
      await applier.apply(vaultAbs, toApply);
    } finally {
      await clearApplyLock(vaultAbs);
    }

    // Após aplicar, marca como sincronizado no state
    const latestAppliedByPath = buildLatestByPath(toApply);
    for (const [p, ev] of latestAppliedByPath.entries()) {
      if (isDeletedEvent(ev)) {
        await upsertStatePatch({
          path: p,
          lastSyncedHash: undefined,
          lastLocalHash: undefined,
          lastRemoteHash: undefined,
        });
      } else {
        const h = pickHashFromEvent(ev);
        if (!h) continue;
        await upsertStatePatch({
          path: p,
          lastSyncedHash: h,
          lastLocalHash: h,
          lastRemoteHash: h,
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 5) Save cursor (após apply)                                         */
  /* ------------------------------------------------------------------ */

  await cursorStore.save(vaultAbs, nextCursor ?? cursor);

  /* ------------------------------------------------------------------ */
  /* 6) PUSH LAST (local -> remote), evita empurrar paths ainda em conflito */
  /* ------------------------------------------------------------------ */

  const finalStatesBeforePush = await stateStore.loadAll(vaultAbs);
  const { conflicts: finalConflictsBeforePush } = compareAllStates(finalStatesBeforePush);

  const blockedPaths = new Set(finalConflictsBeforePush.map((c) => c.path));

  // Dedupe contra remoto antes de enviar
  const remoteAllBeforePushRes = await withRetry(
    () => provider.pullHistoryEvents(null),
    retryPolicy,
    sleep
  );
  const remoteAllBeforePush = remoteAllBeforePushRes.events;

  const remoteIds = new Set(remoteAllBeforePush.map((e) => e.id));

  const signature = (e: HistoryEvent) =>
    `${e.change.path}|${e.change.changeType}|${normalizeHash(e.change.hash)}|${e.occurredAtIso}`;

  const remoteSigs = new Set(remoteAllBeforePush.map(signature));

  const toPush = allLocalEvents.filter(
    (e) =>
      !blockedPaths.has(e.change.path) &&
      !remoteIds.has(e.id) &&
      !remoteSigs.has(signature(e))
  );

  const remoteEventsById = new Map(remoteAllBeforePush.map((e) => [e.id, e]));

  await withRetry(() => provider.pushHistoryEvents(toPush), retryPolicy, sleep);

  // Após push OK, convergir para synced
  const latestPushedByPath = buildLatestByPath(toPush);
  for (const [p, ev] of latestPushedByPath.entries()) {
    if (isDeletedEvent(ev)) {
      await upsertStatePatch({
        path: p,
        lastLocalHash: undefined,
        lastRemoteHash: undefined,
        lastSyncedHash: undefined,
      });
    } else {
      const h = pickHashFromEvent(ev);
      if (!h) continue;

      await upsertStatePatch({
        path: p,
        lastLocalHash: h,
        lastRemoteHash: h,
        lastSyncedHash: h,
      });
    }
  }

  console.log("Push OK:", toPush.length, "novos eventos enviados.");

  // Reconciliar o que já estava no remoto pelo id
  const alreadyInRemote = allLocalEvents.filter((e) => remoteEventsById.has(e.id));
  const latestAckedByPath = buildLatestByPath(alreadyInRemote);

  for (const [p, ev] of latestAckedByPath.entries()) {
    if (isDeletedEvent(ev)) {
      await upsertStatePatch({
        path: p,
        lastLocalHash: undefined,
        lastRemoteHash: undefined,
        lastSyncedHash: undefined,
      });
    } else {
      const h = pickHashFromEvent(ev);
      if (!h) continue;

      await upsertStatePatch({
        path: p,
        lastLocalHash: h,
        lastRemoteHash: h,
        lastSyncedHash: h,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 7) Final summary                                                   */
  /* ------------------------------------------------------------------ */

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
  } else {
    if (blockedPaths.size > 0) {
      console.log(
        "✅ Nenhum conflito restante. Paths que foram bloqueados do push nesta execução:",
        [...blockedPaths]
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
