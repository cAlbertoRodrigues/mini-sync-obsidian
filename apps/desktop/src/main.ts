import { app, BrowserWindow, Menu, ipcMain } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadVaults } from "./ui/state/vaults-store.js";

import {
  RemoteFolderSyncProvider,
  NodeRemoteCursorStore,
  VaultEventApplier,
  NodeSyncStateStore,
  NodeFileHasher,
  NodeHistoryRepository,
  NodeConflictDecisionStore,
  compareAllStates,
  SyncService,
} from "@mini-sync/core-application";

type ConflictStrategy = "keep_local" | "keep_remote" | "manual_merge";
type SyncMode = "remote-folder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Tipos mínimos locais (não dependem do core exportar types)
type ComparisonStatus = "synced" | "local_changed" | "remote_changed" | "conflict";
type FileComparisonLite = { path: string; status: ComparisonStatus };
type ConflictLite = { path: string; type: string };

function getVaultOrThrow(vaultId: string) {
  const v = loadVaults().find((x) => x.id === vaultId);
  if (!v) throw new Error(`Vault not found: ${vaultId}`);
  return v;
}

function requireLocalPath(vaultId: string) {
  const vault = getVaultOrThrow(vaultId);
  const localPath = (vault as any).localPath as string | undefined;

  if (typeof localPath !== "string" || localPath.trim().length === 0) {
    throw new Error("Vault localPath não configurado. Vá em Setup e defina o caminho local.");
  }

  return { vault, localPath: path.resolve(localPath) };
}

function baseCachePath(vaultId: string) {
  return path.join(app.getPath("userData"), "mini-sync", "base-cache", vaultId);
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function safeJoin(root: string, rel: string) {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(rootAbs, rel);

  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  const targetWithSep = targetAbs.endsWith(path.sep) ? targetAbs : targetAbs + path.sep;

  if (!targetWithSep.startsWith(rootWithSep)) {
    throw new Error("Invalid path (outside vault)");
  }

  return targetAbs;
}

/**
 * Remote side (MVP): reconstrói o conteúdo do arquivo remoto lendo o history remoto
 * e pegando o último evento (created/modified) com content para o path.
 */
async function readRemoteFileFromHistory(provider: RemoteFolderSyncProvider, filePath: string) {
  const { events } = await provider.pullHistoryEvents(null);

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.change.path !== filePath) continue;

    if (ev.change.changeType === "deleted") return "";

    if (ev.content && ev.encoding === "utf-8") return ev.content;

    return "";
  }

  return "";
}

function createSyncEngine(args: { vaultId: string; localPath: string; remoteRootDir: string }) {
  const { vaultId, localPath, remoteRootDir } = args;

  const provider = new RemoteFolderSyncProvider(path.resolve(remoteRootDir), vaultId);

  const cursorStore = new NodeRemoteCursorStore(`remote-folder.${vaultId}`);
  const applier = new VaultEventApplier();

  const hasher = new NodeFileHasher();
  const stateStore = new NodeSyncStateStore();
  const historyRepository = new NodeHistoryRepository();
  const decisionStore = new NodeConflictDecisionStore();

  const syncService = new SyncService({
    provider,
    cursorStore,
    applier,
    hasher,
    stateStore,
    historyRepository,
    decisionStore,
  });

  return {
    provider,
    cursorStore,
    applier,
    hasher,
    stateStore,
    historyRepository,
    decisionStore,
    syncService,
    localPath,
  };
}

function registerIpc(win: BrowserWindow) {
  /**
   * ✅ UI: lista mudanças reais (compareAllStates)
   * FIX DEFINITIVO:
   * - força o retorno pra um shape mínimo conhecido
   * - tipa explicitamente os params do map
   */
  ipcMain.handle("changes:list", async (_evt, args) => {
    const { vaultId } = (args ?? {}) as { vaultId?: unknown };
    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");

    const { localPath } = requireLocalPath(vaultId);

    const stateStore = new NodeSyncStateStore();
    const allStates = await stateStore.loadAll(localPath);

    // ✅ força shape (não depende do TS inferir o tipo do core)
    const result = compareAllStates(allStates) as unknown as {
      comparisons: FileComparisonLite[];
      conflicts: ConflictLite[];
    };

    const { comparisons, conflicts } = result;

    const conflictTypeByPath = new Map<string, string>(
      conflicts.map((conflict: ConflictLite) => [conflict.path, conflict.type])
    );

    return comparisons.map((comparison: FileComparisonLite) => {
      const conflictType = conflictTypeByPath.get(comparison.path) ?? null;

      return {
        path: comparison.path,
        status: comparison.status,
        summary:
          comparison.status === "conflict"
            ? `Conflict (${conflictType})`
            : comparison.status === "local_changed"
            ? "Local changed"
            : comparison.status === "remote_changed"
            ? "Remote changed"
            : "Synced",
        conflictType,
        isConflict: comparison.status === "conflict",
        conflictsCount: conflicts.length,
      };
    });
  });

  /**
   * ✅ UI: ler conteúdo por “lado”
   */
  ipcMain.handle("changes:readFileSide", async (_evt, args) => {
    const { vaultId, filePath, side, remoteRootDir } = (args ?? {}) as {
      vaultId?: unknown;
      filePath?: unknown;
      side?: unknown;
      remoteRootDir?: unknown;
    };

    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");
    if (typeof filePath !== "string") throw new Error("Parâmetro inválido: filePath");
    if (side !== "local" && side !== "base" && side !== "remote") {
      throw new Error("Parâmetro inválido: side");
    }

    if (side === "local") {
      const { localPath } = requireLocalPath(vaultId);
      const abs = safeJoin(localPath, filePath);
      return await fs.readFile(abs, "utf8");
    }

    if (side === "base") {
      const cacheRoot = baseCachePath(vaultId);
      const abs = safeJoin(cacheRoot, filePath);
      return await fs.readFile(abs, "utf8");
    }

    if (typeof remoteRootDir !== "string" || remoteRootDir.trim().length === 0) {
      throw new Error("Parâmetro inválido: remoteRootDir (necessário para side=remote)");
    }

    const { provider } = createSyncEngine({
      vaultId,
      localPath: requireLocalPath(vaultId).localPath,
      remoteRootDir,
    });

    return await readRemoteFileFromHistory(provider, filePath);
  });

  /**
   * ✅ UI: salvar merge manual no LOCAL
   */
  ipcMain.handle("changes:saveMerged", async (_evt, args) => {
    const { vaultId, filePath, content } = (args ?? {}) as {
      vaultId?: unknown;
      filePath?: unknown;
      content?: unknown;
    };

    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");
    if (typeof filePath !== "string") throw new Error("Parâmetro inválido: filePath");
    if (typeof content !== "string") throw new Error("Parâmetro inválido: content");

    const { localPath } = requireLocalPath(vaultId);
    const abs = safeJoin(localPath, filePath);

    await ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content, "utf8");

    return { ok: true };
  });

  /**
   * ✅ UI: aceitar resolução
   */
  ipcMain.handle("changes:acceptResolution", async (_evt, args) => {
    const { vaultId, filePath, strategy } = (args ?? {}) as {
      vaultId?: unknown;
      filePath?: unknown;
      strategy?: unknown;
    };

    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");
    if (typeof filePath !== "string") throw new Error("Parâmetro inválido: filePath");
    if (strategy !== "keep_local" && strategy !== "keep_remote" && strategy !== "manual_merge") {
      throw new Error("Parâmetro inválido: strategy");
    }

    const { localPath } = requireLocalPath(vaultId);
    const decisionStore = new NodeConflictDecisionStore();

    const mapped: "local" | "remote" = strategy === "keep_remote" ? "remote" : "local";

    await decisionStore.set(localPath, {
      path: filePath.replaceAll("\\", "/"),
      strategy: mapped,
      decidedAtIso: new Date().toISOString(),
    });

    return { ok: true, strategy, filePath };
  });

  /**
   * ✅ sync real
   */
  ipcMain.handle("sync:run", async (_evt, args) => {
    const { vaultId, mode, remoteRootDir, defaultStrategy } = (args ?? {}) as {
      vaultId?: unknown;
      mode?: unknown;
      remoteRootDir?: unknown;
      defaultStrategy?: unknown;
    };

    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");
    if (mode !== "remote-folder") throw new Error("Parâmetro inválido: mode (use remote-folder)");
    if (typeof remoteRootDir !== "string" || remoteRootDir.trim().length === 0) {
      throw new Error("Parâmetro inválido: remoteRootDir");
    }

    const { localPath } = requireLocalPath(vaultId);

    const strategy: "local" | "remote" = defaultStrategy === "remote" ? "remote" : "local";

    const engine = createSyncEngine({ vaultId, localPath, remoteRootDir });

    win.webContents.send("sync:status", {
      vaultId,
      status: "syncing",
      atIso: new Date().toISOString(),
    });

    try {
      const summary = await engine.syncService.syncOnce({
        vaultRootAbs: localPath,
        defaultConflictStrategy: strategy,
      });

      win.webContents.send("sync:status", {
        vaultId,
        status: summary.conflictsAfter > 0 ? "conflict" : "ok",
        atIso: new Date().toISOString(),
        summary,
      });

      return { ok: true, summary };
    } catch (e: any) {
      win.webContents.send("sync:status", {
        vaultId,
        status: "error",
        atIso: new Date().toISOString(),
        error: String(e?.message ?? e),
      });
      throw e;
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 813,
    height: 654,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const win = createWindow();
  registerIpc(win);
});
