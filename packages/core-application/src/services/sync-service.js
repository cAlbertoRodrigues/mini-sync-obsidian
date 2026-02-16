import path from "node:path";
import fs from "node:fs/promises";
import { compareAllStates } from "./sync-diff";
import { resolveKeepLocal } from "./keep-local";
import { resolveKeepRemote } from "./keep-remote";
import { withRetry } from "../application/with-retry";
import { defaultNetworkRetryPolicy } from "../application/default-network-retry-policy";
import { sleep } from "../infra/sleep";
import { setApplyLock, clearApplyLock } from "../adapters/apply-lock";
const retryPolicy = defaultNetworkRetryPolicy();
/**
 * Converte hash para string comparável. Suporta:
 * - string
 * - { algorithm, value }
 */
function normalizeHash(h) {
    if (!h)
        return undefined;
    if (typeof h === "string")
        return h;
    if (typeof h === "object" && typeof h.value === "string")
        return h.value;
    return undefined;
}
/**
 * Se localHash e remoteHash são iguais, então o arquivo está "synced":
 * - lastSyncedHash precisa refletir isso (senão o diff acusa coisas erradas)
 */
function reconcileSynced(state) {
    const lh = normalizeHash(state.lastLocalHash);
    const rh = normalizeHash(state.lastRemoteHash);
    if (lh && rh && lh === rh) {
        state.lastSyncedHash = state.lastLocalHash;
        return;
    }
    if (!lh && !rh) {
        state.lastSyncedHash = undefined;
    }
}
function pickHashFromEvent(e) {
    return e?.change?.hash;
}
function isDeletedEvent(e) {
    return e?.change?.changeType === "deleted";
}
function buildLatestByPath(events) {
    const sorted = [...events].sort((a, b) => {
        const aa = new Date(a.occurredAtIso).getTime();
        const bb = new Date(b.occurredAtIso).getTime();
        return aa - bb;
    });
    const map = new Map();
    for (const e of sorted)
        map.set(e.change.path, e);
    return map;
}
async function readJsonlEvents(filePath) {
    const out = [];
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const l of lines) {
        try {
            out.push(JSON.parse(l));
        }
        catch {
            // tolerante a linhas inválidas
        }
    }
    return out;
}
async function readAllLocalHistory(vaultAbs) {
    const localHistoryDir = path.join(vaultAbs, ".mini-sync", "history");
    let files = [];
    try {
        files = (await fs.readdir(localHistoryDir)).filter((f) => f.endsWith(".jsonl")).sort();
    }
    catch {
        files = [];
    }
    const all = [];
    for (const f of files) {
        const fp = path.join(localHistoryDir, f);
        const events = await readJsonlEvents(fp);
        all.push(...events);
    }
    return all;
}
export class SyncService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async syncOnce(params) {
        const { vaultRootAbs, defaultConflictStrategy } = params;
        const { provider, cursorStore, applier, hasher, stateStore, historyRepository, decisionStore, } = this.deps;
        const nowIso = () => new Date().toISOString();
        async function upsertStatePatch(patch) {
            const prev = await stateStore.get(vaultRootAbs, patch.path);
            const merged = {
                lastSyncedHash: prev?.lastSyncedHash,
                lastLocalHash: prev?.lastLocalHash,
                lastRemoteHash: prev?.lastRemoteHash,
                updatedAtIso: nowIso(),
                ...patch,
            };
            const patchExplicitlySetSynced = Object.prototype.hasOwnProperty.call(patch, "lastSyncedHash");
            if (!patchExplicitlySetSynced) {
                reconcileSynced(merged);
            }
            await stateStore.upsert(vaultRootAbs, merged);
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
            }
            else {
                const h = pickHashFromEvent(ev);
                if (h)
                    await upsertStatePatch({ path: p, lastLocalHash: h });
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
            }
            else {
                const h = pickHashFromEvent(ev);
                if (h)
                    await upsertStatePatch({ path: p, lastRemoteHash: h });
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
                const chosen = saved?.strategy ?? defaultConflictStrategy;
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
                }
                else {
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
        if (toApply.length > 0) {
            await setApplyLock(vaultRootAbs);
            try {
                await applier.apply(vaultRootAbs, toApply);
            }
            finally {
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
                }
                else {
                    const h = pickHashFromEvent(ev);
                    if (!h)
                        continue;
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
        const signature = (e) => `${e.change.path}|${e.change.changeType}|${normalizeHash(e.change.hash)}|${e.occurredAtIso}`;
        const remoteSigs = new Set(remoteAllBeforePush.events.map(signature));
        const toPush = allLocalEvents.filter((e) => !blockedPaths.has(e.change.path) &&
            !remoteIds.has(e.id) &&
            !remoteSigs.has(signature(e)));
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
            }
            else {
                const h = pickHashFromEvent(ev);
                if (!h)
                    continue;
                await upsertStatePatch({
                    path: p,
                    lastLocalHash: h,
                    lastRemoteHash: h,
                    lastSyncedHash: h,
                });
            }
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
