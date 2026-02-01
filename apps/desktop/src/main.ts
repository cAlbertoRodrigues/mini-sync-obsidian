import { app, BrowserWindow, Menu, ipcMain } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadVaults } from "./ui/state/vaults-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVaultOrThrow(vaultId: string) {
  const v = loadVaults().find((x) => x.id === vaultId);
  if (!v) throw new Error(`Vault not found: ${vaultId}`);
  return v;
}

function requireLocalPath(vaultId: string) {
  const vault = getVaultOrThrow(vaultId);
  const localPath = vault.localPath;

  if (typeof localPath !== "string" || localPath.trim().length === 0) {
    throw new Error("Vault localPath não configurado. Vá em Setup e defina o caminho local.");
  }

  return { vault, localPath };
}

function baseCachePath(vaultId: string) {
  return path.join(app.getPath("userData"), "mini-sync", "base-cache", vaultId);
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function safeJoin(root: string, rel: string) {
  // evita path traversal (..)
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(rootAbs, rel);

  // garante rootAbs como prefixo de path com separador (evita /foo vs /foobar)
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  const targetWithSep = targetAbs.endsWith(path.sep) ? targetAbs : targetAbs + path.sep;

  if (!targetWithSep.startsWith(rootWithSep)) {
    throw new Error("Invalid path (outside vault)");
  }

  return targetAbs;
}

function registerIpc() {
  ipcMain.handle("changes:list", async (_evt, args) => {
    const { vaultId } = (args ?? {}) as { vaultId?: unknown };
    if (typeof vaultId !== "string") throw new Error("Parâmetro inválido: vaultId");

    // só valida se existe mesmo
    getVaultOrThrow(vaultId);

    // MVP: lista fake até ligar no sync-diff/store real
    return [
      { path: "README.md", status: "local_changed", summary: "Local changed" },
      { path: "Notes/Conflito.md", status: "conflict", summary: "Conflict" },
    ];
  });

  ipcMain.handle("changes:readFileSide", async (_evt, args) => {
    const { vaultId, filePath, side } = (args ?? {}) as {
      vaultId?: unknown;
      filePath?: unknown;
      side?: unknown;
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

    // side === "remote"
    // Aqui você pluga o provider e baixa o conteúdo.
    return `REMOTE CONTENT (TODO) for ${filePath}`;
  });

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

    // garante que vault existe
    getVaultOrThrow(vaultId);

    // TODO: salvar decisão no ConflictDecisionStore do core-application
    return { ok: true, strategy, filePath };
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
});
