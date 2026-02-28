import path from "node:path";
import fs from "node:fs/promises";

import { NodeBlobStore } from "../adapters/node-blob-store";
import { SnapshotService } from "./snapshot-service";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";

import type { SyncProvider } from "../ports/sync-provider";
import type { FileHash } from "../ports/file-hasher";
import type { HistoryEvent } from "../value-objects/history-event";
import type { FileSyncState } from "../value-objects/file-sync-state";
import type { ConflictResolutionStrategy } from "../ports/conflict-decision-store";

import { compareAllStates } from "./sync-diff";
import { resolveKeepLocal } from "./keep-local";
import { resolveKeepRemote } from "./keep-remote";

import { withRetry } from "../application/with-retry";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { sleep } from "../infra/sleep";

import { setApplyLock, clearApplyLock } from "../adapters/apply-lock";
import { NodeRemoteCursorStore } from "../adapters/node-remote-cursor-store";
import { NodeSyncStateStore } from "../adapters/node-sync-state-store";
import { NodeFileHasher } from "../adapters/node-file-hasher";
import { NodeHistoryRepository } from "../adapters/node-history-repository";
import { NodeConflictDecisionStore } from "../adapters/node-conflict-decision-store";
import { VaultEventApplier } from "../adapters/vault-event-applier";

export type ConflictType =
  | "both_modified"
  | "local_deleted_remote_modified"
  | "remote_deleted_local_modified";
export type Conflict = { path: string; type: ConflictType };

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

function pickHashFromEvent(e: HistoryEvent): FileHash | undefined {
  return e?.change?.hash;
}

function isDeletedEvent(e: HistoryEvent) {
  return e?.change?.changeType === "deleted";
}

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

async function readJsonlEvents(filePath: string): Promise<HistoryEvent[]> {
  const out: HistoryEvent[] = [];
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  for (const l of lines) {
    try {
      out.push(JSON.parse(l) as HistoryEvent);
    } catch {
      // tolerante a linhas inválidas
    }
  }
  return out;
}

async function readAllLocalHistory(vaultAbs: string): Promise<HistoryEvent[]> {
  const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");
  let files: string[] = [];
  try {
    files = (await fs.readdir(localHistoryDir)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    files = [];
  }

  const all: HistoryEvent[] = [];
  for (const f of files) {
    const fp = path.join(localHistoryDir, f);
    const events = await readJsonlEvents(fp);
    all.push(...events);
  }
  return all;
}

export type SyncRunSummary = {
  pulledApplied: number;
  pushed: number;

  conflictsBefore: number;
  conflictsAfter: number;

  cursorBefore: string | null;
  cursorAfter: string | null;

  blockedConflictPaths: string[];
};

export class SyncService {
  constructor(
    private readonly deps: {
      provider: SyncProvider;
      cursorStore: NodeRemoteCursorStore;
      applier: VaultEventApplier;

      hasher: NodeFileHasher;
      stateStore: NodeSyncStateStore;
      historyRepository: NodeHistoryRepository;
      decisionStore: NodeConflictDecisionStore;

      // NOVO
      blobStore: NodeBlobStore;
      snapshotService: SnapshotService;
    }
  ) {}

  async syncOnce(params: {
    vaultRootAbs: string;
    defaultConflictStrategy: ConflictResolutionStrategy; // "local" | "remote"
  }): Promise<SyncRunSummary> {
    const { vaultRootAbs, defaultConflictStrategy } = params;
    const {
      provider,
      cursorStore,
      applier,
      hasher,
      stateStore,
      historyRepository,
      decisionStore,
      blobStore,
      snapshotService,
    } = this.deps;

    const vaultId = path.basename(vaultRootAbs);
    const nowIso = () => new Date().toISOString();

    async function upsertStatePatch(patch: Partial<FileSyncState> & { path: string }) {
      const prev = await stateStore.get(vaultRootAbs, patch.path);

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

      await stateStore.upsert(vaultRootAbs, merged);
    }

    async function isVaultProbablyEmpty(): Promise<boolean> {
      try {
        const entries = await fs.readdir(vaultRootAbs, { withFileTypes: true });
        const meaningful = entries.filter((e) => e.name !== ".obsidian" && e.name !== ".mini-sync");
        return meaningful.length === 0;
      } catch {
        return false;
      }
    }

    async function restoreFromSnapshotManifest(manifest: SnapshotManifest): Promise<void> {
      for (const f of manifest.files) {
        const abs = path.join(vaultRootAbs, f.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });

        // 1) inline text
        if (f.inlineTextUtf8 !== undefined) {
          await fs.writeFile(abs, f.inlineTextUtf8, "utf-8");
          continue;
        }

        // 2) blob
        const sha = f.blobSha256 ?? f.sha256;
        if (!(await blobStore.has(vaultRootAbs, sha))) {
          const remoteHas = await withRetry(() => provider.hasBlob({ sha256: sha }), retryPolicy, sleep);
          if (remoteHas) {
            const data = await withRetry(() => provider.getBlob({ sha256: sha }), retryPolicy, sleep);
            await blobStore.put(vaultRootAbs, sha, data);
          }
        }

        const data = await blobStore.get(vaultRootAbs, sha);
        await fs.writeFile(abs, data);
      }
    }

    /* ------------------------------------------------------------- */
    /* 0) Bootstrap: vault vazio + snapshot remoto                     */
    /* ------------------------------------------------------------- */
    if (await isVaultProbablyEmpty()) {
      const snaps = await withRetry(() => provider.listSnapshots(), retryPolicy, sleep);
      if (snaps.length > 0) {
        const latest = snaps[snaps.length - 1]!;
        const manifest = await withRetry(() => provider.getSnapshotManifest(latest), retryPolicy, sleep);
        await restoreFromSnapshotManifest(manifest);
      }
    }

    /* ------------------------------------------------------------- */
    /* 1) Read local history -> update lastLocalHash                   */
    /* ------------------------------------------------------------- */
    await historyRepository.ensureStructure(vaultRootAbs);

    const allLocalEvents = await readAllLocalHistory(vaultRootAbs);
    const latestLocalByPath = buildLatestByPath(allLocalEvents);

    for (const [p, ev] of latestLocalByPath.entries()) {
      if (isDeletedEvent(ev)) {
        await upsertStatePatch({ path: p, lastLocalHash: undefined });
      } else {
        const h = pickHashFromEvent(ev);
        if (h) await upsertStatePatch({ path: p, lastLocalHash: h });
      }
    }

    /* ------------------------------------------------------------- */
    /* 2) Pull remote changes since cursor -> update lastRemoteHash    */
    /* ------------------------------------------------------------- */
    const cursor = await cursorStore.load(vaultRootAbs);
    const cursorBefore = cursor?.value ?? null;

    const pullRes = await withRetry(() => provider.pullHistoryEvents(cursor), retryPolicy, sleep);

    const pulled = pullRes.events;
    const nextCursor = pullRes.nextCursor;

    const latestRemoteByPath = buildLatestByPath(pulled);
    for (const [p, ev] of latestRemoteByPath.entries()) {
      if (isDeletedEvent(ev)) {
        await upsertStatePatch({ path: p, lastRemoteHash: undefined });
      } else {
        const h = pickHashFromEvent(ev);
        if (h) await upsertStatePatch({ path: p, lastRemoteHash: h });
      }
    }

    /* ------------------------------------------------------------- */
    /* 3) Detect + resolve conflicts BEFORE applying remote events     */
    /* ------------------------------------------------------------- */
    const allStatesBefore = await stateStore.loadAll(vaultRootAbs);
    const { conflicts: conflictsBefore } = compareAllStates(allStatesBefore);

    // puxa “remoto completo” (necessário para keep-remote reconstituir)
    const remoteAllNow = await withRetry(() => provider.pullHistoryEvents(null), retryPolicy, sleep);

    if (conflictsBefore.length > 0) {
      for (const c of conflictsBefore) {
        const rel = c.path.replaceAll("\\", "/");

        const saved = await decisionStore.get(vaultRootAbs, rel);
        const chosen: ConflictResolutionStrategy = saved?.strategy ?? defaultConflictStrategy;

        await decisionStore.set(vaultRootAbs, {
          path: rel,
          strategy: chosen,
          decidedAtIso: new Date().toISOString(),
        });

        if (chosen === "local") {
          await resolveKeepLocal({
            vaultRootAbs,
            conflicts: [c],
            hasher,
            provider,
            historyRepository,
            stateStore,
          });
        } else {
          await resolveKeepRemote({
            vaultRootAbs,
            conflicts: [c],
            pulledRemoteEvents: remoteAllNow.events,
            hasher,
            historyRepository,
            stateStore,
          });
        }
      }
    }

    // conflitados ainda após resolução
    const statesAfterResolution = await stateStore.loadAll(vaultRootAbs);
    const { conflicts: conflictsAfterResolution } = compareAllStates(statesAfterResolution);
    const conflictPaths = new Set(conflictsAfterResolution.map((c) => c.path));

    /* ------------------------------------------------------------- */
    /* 4) Apply remote events (excluding conflicts) + mark synced      */
    /* ------------------------------------------------------------- */
    const toApply = pulled.filter((ev) => !conflictPaths.has(ev.change.path));

    // NOVO: garantir blobs locais antes do apply
    for (const ev of toApply) {
      const sha = ev.blob?.sha256;
      if (!sha) continue;
      if (await blobStore.has(vaultRootAbs, sha)) continue;

      const data = await withRetry(() => provider.getBlob({ sha256: sha }), retryPolicy, sleep);
      await blobStore.put(vaultRootAbs, sha, data);
    }

    if (toApply.length > 0) {
      await setApplyLock(vaultRootAbs);
      try {
        await applier.apply(vaultRootAbs, toApply);
      } finally {
        await clearApplyLock(vaultRootAbs);
      }

      // após aplicar, convergir hash para synced
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

    /* ------------------------------------------------------------- */
    /* 5) Save cursor (after apply)                                   */
    /* ------------------------------------------------------------- */
    await cursorStore.save(vaultRootAbs, nextCursor ?? cursor);
    const cursorAfter = (nextCursor ?? cursor)?.value ?? null;

    /* ------------------------------------------------------------- */
    /* 6) Push last: local -> remote (avoid conflict paths)            */
    /* ------------------------------------------------------------- */
    const finalStatesBeforePush = await stateStore.loadAll(vaultRootAbs);
    const { conflicts: finalConflictsBeforePush } = compareAllStates(finalStatesBeforePush);

    const blockedPaths = new Set(finalConflictsBeforePush.map((c) => c.path));

    // dedupe contra remoto antes de enviar
    const remoteAllBeforePush = await withRetry(() => provider.pullHistoryEvents(null), retryPolicy, sleep);

    const remoteIds = new Set(remoteAllBeforePush.events.map((e) => e.id));
    const signature = (e: HistoryEvent) =>
      `${e.change.path}|${e.change.changeType}|${normalizeHash(e.change.hash)}|${e.occurredAtIso}`;
    const remoteSigs = new Set(remoteAllBeforePush.events.map(signature));

    const toPush = allLocalEvents.filter(
      (e) =>
        !blockedPaths.has(e.change.path) &&
        !remoteIds.has(e.id) &&
        !remoteSigs.has(signature(e))
    );

    // NOVO: garantir blobs no remoto antes de enviar eventos
    for (const ev of toPush) {
      const sha = ev.blob?.sha256;
      if (!sha) continue;

      const existsRemote = await withRetry(() => provider.hasBlob({ sha256: sha }), retryPolicy, sleep);
      if (existsRemote) continue;

      if (!(await blobStore.has(vaultRootAbs, sha))) {
        // fallback: tenta ler do arquivo atual do vault
        const abs = path.join(vaultRootAbs, ev.change.path.replaceAll("\\", "/"));
        const buf = await fs.readFile(abs);
        await blobStore.put(vaultRootAbs, sha, buf);
      }

      const buf = await blobStore.get(vaultRootAbs, sha);
      await withRetry(() => provider.putBlob({ sha256: sha }, buf), retryPolicy, sleep);
    }

    await withRetry(() => provider.pushHistoryEvents(toPush), retryPolicy, sleep);

    // após push OK: convergir para synced imediatamente
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

    /* ------------------------------------------------------------- */
    /* 6.1) Snapshot: publicar manifest após push (concreto)           */
    /* ------------------------------------------------------------- */
    if (toPush.length > 0) {
      const manifest = await snapshotService.createSnapshotManifest({
        vaultRootAbs,
        vaultId,
      });

      // garantir blobs do manifest no remoto
      for (const f of manifest.files) {
        const sha = f.blobSha256;
        if (!sha) continue;

        const ok = await withRetry(() => provider.hasBlob({ sha256: sha }), retryPolicy, sleep);
        if (ok) continue;

        if (!(await blobStore.has(vaultRootAbs, sha))) {
          // snapshot-service geralmente já colocou; mas garante
          const abs = path.join(vaultRootAbs, f.path);
          const buf = await fs.readFile(abs);
          await blobStore.put(vaultRootAbs, sha, buf);
        }

        const buf = await blobStore.get(vaultRootAbs, sha);
        await withRetry(() => provider.putBlob({ sha256: sha }, buf), retryPolicy, sleep);
      }

      await withRetry(
        () => provider.putSnapshotManifest({ id: manifest.id }, manifest),
        retryPolicy,
        sleep
      );
    }

    /* ------------------------------------------------------------- */
    /* 7) Final conflicts summary                                      */
    /* ------------------------------------------------------------- */
    const allStatesAfter = await stateStore.loadAll(vaultRootAbs);
    const { conflicts: conflictsAfter } = compareAllStates(allStatesAfter);

    return {
      pulledApplied: toApply.length,
      pushed: toPush.length,
      conflictsBefore: conflictsBefore.length,
      conflictsAfter: conflictsAfter.length,
      cursorBefore,
      cursorAfter,
      blockedConflictPaths: [...blockedPaths],
    };
  }
}