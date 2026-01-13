import path from "node:path";
import fs from "node:fs/promises";

import { GoogleAuth } from "../adapters/google-auth";
import { GoogleDriveSyncProvider } from "../adapters/google-drive-sync-provider";

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
import type { SyncCursor } from "../ports/sync-provider";

import { compareAllStates } from "../services/sync-diff";
import { resolveKeepLocal } from "../services/keep-local";
import { resolveKeepRemote } from "../services/keep-remote";

import { withRetry } from "../application/with-retry";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { sleep } from "../infra/sleep";

const retryPolicy = defaultNetworkRetryPolicy();

function normalizeHash(h: any): string | undefined {
  if (!h) return undefined;
  if (typeof h === "string") return h;
  if (typeof h === "object" && typeof h.value === "string") return h.value;
  return undefined;
}

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
  } catch {}

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

/**
 * ✅ Remove ruído do watcher:
 * Eventos "modified" repetidos para o mesmo path com o MESMO hash
 * (ex.: salvar sem alterar conteúdo).
 *
 * Importante: mantém deletes e creates; só filtra modified redundante.
 */
function dedupeLocalNoHashChange(events: HistoryEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  const lastHashByPath = new Map<string, string | undefined>();

  // processa em ordem cronológica
  const sorted = [...events].sort((a, b) =>
    a.occurredAtIso < b.occurredAtIso ? -1 : a.occurredAtIso > b.occurredAtIso ? 1 : 0
  );

  for (const e of sorted) {
    const p = e.change.path;
    const type = e.change.changeType;
    const h = normalizeHash(e.change.hash);

    if (type === "modified") {
      const prev = lastHashByPath.get(p);
      if (prev && h && prev === h) {
        // mesmo hash => ignora evento redundante
        continue;
      }
    }

    lastHashByPath.set(p, h);
    out.push(e);
  }

  return out;
}

function friendlyAuthError(e: unknown) {
  const msg = String((e as any)?.message ?? e);
  if (msg.includes("ENOENT") || msg.includes("google.credentials.json")) {
    return `Credencial ausente: coloque "google.credentials.json" em ".mini-sync/secrets/" do vault.`;
  }
  if (msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
    return `Token inválido/expirado: apague ".mini-sync/secrets/google.tokens.json" e rode novamente para autenticar.`;
  }
  return null;
}

async function main() {
  const localVault = process.argv[2];
  const strategyArg = (process.argv[3] ?? "local").toLowerCase();
  const vaultIdArg = process.argv[4];

  if (!localVault) {
    console.error('Uso: pnpm dev:sync-drive -- "<vaultAbs>" [local|remote] [vaultId]');
    process.exit(1);
  }

  const strategy: ConflictResolutionStrategy = strategyArg === "remote" ? "remote" : "local";
  const vaultAbs = path.resolve(localVault);

  await warnIfProbablyWrongVaultPath(vaultAbs);

  // identidade simples (pasta do vault)
  const vaultId = vaultIdArg ?? path.basename(vaultAbs);

  const tokenDirAbs = path.join(vaultAbs, ".mini-sync", "secrets");
  const credentialsPathAbs = path.join(tokenDirAbs, "google.credentials.json");

  try {
    const ga = new GoogleAuth({ tokenDirAbs, credentialsPathAbs });
    const auth = await ga.getAuthorizedClient();

    const provider = new GoogleDriveSyncProvider(auth, vaultId);
    // ✅ Cursor namespaced por provider+vaultId: drive.<vaultId>
    const cursorStore = new NodeRemoteCursorStore(`drive.${vaultId}`);
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
      if (!patchExplicitlySetSynced) reconcileSynced(merged);

      await stateStore.upsert(vaultAbs, merged);
    }

    /* ------------------------------------------------------------------ */
    /* 1) Read local history                                                */
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
      for (const l of lines) allLocalEvents.push(JSON.parse(l) as HistoryEvent);
    }

    console.log("Eventos locais encontrados:", allLocalEvents.length);

    // Atualiza lastLocalHash baseado no último evento por path
    const latestLocalByPath = buildLatestByPath(allLocalEvents);
    for (const [p, ev] of latestLocalByPath.entries()) {
      if (isDeletedEvent(ev)) await upsertStatePatch({ path: p, lastLocalHash: undefined });
      else {
        const h = pickHashFromEvent(ev);
        if (h) await upsertStatePatch({ path: p, lastLocalHash: h });
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2) Pull incremental (Drive)                                          */
    /* ------------------------------------------------------------------ */

    const currentCursor: SyncCursor | null = await cursorStore.load(vaultAbs);
    console.log("Pull a partir do cursor:", currentCursor?.value ?? "null");

    const { events: pulled, nextCursor } = await withRetry(
      () => provider.pullHistoryEvents(currentCursor),
      retryPolicy,
      sleep
    );

    console.log("Pulled:", pulled.length, "nextCursor:", nextCursor?.value ?? "null");

    // Atualiza lastRemoteHash baseado no último evento puxado por path
    const latestRemoteByPath = buildLatestByPath(pulled);
    for (const [p, ev] of latestRemoteByPath.entries()) {
      if (isDeletedEvent(ev)) await upsertStatePatch({ path: p, lastRemoteHash: undefined });
      else {
        const h = pickHashFromEvent(ev);
        if (h) await upsertStatePatch({ path: p, lastRemoteHash: h });
      }
    }

    /* ------------------------------------------------------------------ */
    /* 3) Conflicts before apply                                            */
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

    // Puxa todo remoto para resolver keep-remote e para dedupe
    const remoteAllNow = await withRetry(() => provider.pullAllHistoryEvents(), retryPolicy, sleep);

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
            pulledRemoteEvents: remoteAllNow,
            hasher,
            historyRepository,
            stateStore,
          });
        }

        console.log(`✅ Conflito resolvido (${rel}) com estratégia: ${chosen}`);
      }
    }

    const statesAfterResolution = await stateStore.loadAll(vaultAbs);
    const { conflicts: conflictsAfterResolution } = compareAllStates(statesAfterResolution);
    const conflictPaths = new Set(conflictsAfterResolution.map((c) => c.path));

    /* ------------------------------------------------------------------ */
    /* 4) Apply remote events (com lock), excluindo conflitos               */
    /* ------------------------------------------------------------------ */

    const toApply = pulled.filter((ev) => !conflictPaths.has(ev.change.path));
    console.log("Aplicando eventos remotos:", toApply.length);

    if (toApply.length > 0) {
      await setApplyLock(vaultAbs);
      try {
        await applier.apply(vaultAbs, toApply);
      } finally {
        await clearApplyLock(vaultAbs);
        await sleep(1500);
      }

      // Após apply, convergir lastSynced/Local/Remote para o hash aplicado
      const latestApplied = buildLatestByPath(toApply);
      for (const [p, ev] of latestApplied.entries()) {
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
    /* 5) Salvar cursor local (após apply)                                  */
    /* ------------------------------------------------------------------ */

    const cursorToSave = nextCursor ?? currentCursor;
    await cursorStore.save(vaultAbs, cursorToSave);

    /* ------------------------------------------------------------------ */
    /* 6) Push incremental (dedupe)                                         */
    /* ------------------------------------------------------------------ */

    const finalStatesBeforePush = await stateStore.loadAll(vaultAbs);
    const { conflicts: finalConflictsBeforePush } = compareAllStates(finalStatesBeforePush);

    const blockedPaths = new Set(finalConflictsBeforePush.map((c) => c.path));

    const remoteAllBeforePush = remoteAllNow; // já baixado acima
    const remoteIds = new Set(remoteAllBeforePush.map((e) => e.id));
    const signature = (e: HistoryEvent) =>
      `${e.change.path}|${e.change.changeType}|${normalizeHash(e.change.hash)}|${e.occurredAtIso}`;

    const remoteSigs = new Set(remoteAllBeforePush.map(signature));

    // ✅ remove ruído local antes de calcular pendências
    const localCandidates = dedupeLocalNoHashChange(allLocalEvents);

    const toPush = localCandidates.filter(
      (e) =>
        !blockedPaths.has(e.change.path) &&
        !remoteIds.has(e.id) &&
        !remoteSigs.has(signature(e))
    );

    await withRetry(() => provider.pushHistoryEvents(toPush), retryPolicy, sleep);

    console.log("Push OK:", toPush.length, "novos eventos enviados.");

    // ✅ Após push bem-sucedido, convergir estado (evita precisar rodar 2x)
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

    /* ------------------------------------------------------------------ */
    /* 7) Cursor remoto final (Drive)                                       */
    /* ------------------------------------------------------------------ */

    // cursor remoto deve refletir o max( cursor salvo do pull , last pushed )
    const pulledIso = cursorToSave?.value ?? null;
    const pushedIso = toPush.length > 0 ? toPush[toPush.length - 1]!.occurredAtIso : null;

    let newRemoteIso: string | null = pulledIso ?? null;
    if (pulledIso && pushedIso) newRemoteIso = pulledIso > pushedIso ? pulledIso : pushedIso;
    else if (pushedIso) newRemoteIso = pushedIso;

    await provider.setRemoteCursor(newRemoteIso ? { value: newRemoteIso } : null);
    console.log("Cursor remoto atualizado:", newRemoteIso ?? "null");

    // ✅ também atualiza cursor LOCAL para não repuxar o que acabou de mandar
    await cursorStore.save(vaultAbs, newRemoteIso ? { value: newRemoteIso } : null);
    console.log("Cursor local atualizado:", newRemoteIso ?? "null");

    /* ------------------------------------------------------------------ */
    /* 8) Final summary                                                     */
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
    }
  } catch (e) {
    const friendly = friendlyAuthError(e);
    if (friendly) console.error(friendly);
    else console.error(e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
