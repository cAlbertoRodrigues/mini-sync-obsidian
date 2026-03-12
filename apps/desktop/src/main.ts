import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	compareAllStates,
	NodeConflictDecisionStore,
	NodeFileHasher,
	NodeHistoryRepository,
	NodeRemoteCursorStore,
	NodeSyncStateStore,
	RemoteFolderSyncProvider,
	SyncService,
	VaultEventApplier,
} from "@mini-sync/core-application";
import { app, BrowserWindow, ipcMain, Menu } from "electron";

import { loadVaults, type VaultItem } from "./ui/state/vaults-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Estados simplificados usados na comparação de arquivos para a UI.
 */
type ComparisonStatus =
	| "synced"
	| "local_changed"
	| "remote_changed"
	| "conflict";

/**
 * Representa o resultado mínimo de comparação de um arquivo.
 */
type FileComparisonLite = { path: string; status: ComparisonStatus };

/**
 * Representa um conflito detectado para um arquivo.
 */
type ConflictLite = { path: string; type: string };

/**
 * Resumo mínimo retornado pela sincronização para a interface.
 */
type SyncRunSummary = {
	conflictsAfter: number;
};

/**
 * Obtém um vault persistido pelo seu identificador.
 *
 * @param vaultId Identificador do vault.
 * @returns Vault encontrado no armazenamento local.
 * @throws Error Quando o vault não existe.
 */
function getVaultOrThrow(vaultId: string): VaultItem {
	const vault = loadVaults().find((x) => x.id === vaultId);
	if (!vault) {
		throw new Error(`Vault not found: ${vaultId}`);
	}
	return vault;
}

/**
 * Garante que o vault possua um caminho local configurado.
 *
 * @param vaultId Identificador do vault.
 * @returns Vault encontrado e caminho local absoluto.
 * @throws Error Quando `localPath` não está configurado.
 */
function requireLocalPath(vaultId: string) {
	const vault = getVaultOrThrow(vaultId);
	const localPath = vault.localPath;

	if (typeof localPath !== "string" || localPath.trim().length === 0) {
		throw new Error(
			"Vault localPath não configurado. Vá em Setup e defina o caminho local.",
		);
	}

	return { vault, localPath: path.resolve(localPath) };
}

/**
 * Retorna o diretório de cache local da versão base de arquivos para um vault.
 *
 * @param vaultId Identificador do vault.
 * @returns Caminho absoluto do diretório de cache base.
 */
function baseCachePath(vaultId: string) {
	return path.join(app.getPath("userData"), "mini-sync", "base-cache", vaultId);
}

/**
 * Garante a existência de um diretório e de todos os seus pais.
 *
 * @param p Caminho do diretório.
 */
async function ensureDir(p: string) {
	await fs.mkdir(p, { recursive: true });
}

/**
 * Resolve um caminho relativo dentro de uma raiz e impede acesso
 * a caminhos fora do diretório permitido.
 *
 * @param root Diretório raiz permitido.
 * @param rel Caminho relativo solicitado.
 * @returns Caminho absoluto validado.
 * @throws Error Quando o caminho final sai da raiz informada.
 */
function safeJoin(root: string, rel: string) {
	const rootAbs = path.resolve(root);
	const targetAbs = path.resolve(rootAbs, rel);

	const rootWithSep = rootAbs.endsWith(path.sep)
		? rootAbs
		: `${rootAbs}${path.sep}`;
	const targetWithSep = targetAbs.endsWith(path.sep)
		? targetAbs
		: `${targetAbs}${path.sep}`;

	if (!targetWithSep.startsWith(rootWithSep)) {
		throw new Error("Invalid path (outside vault)");
	}

	return targetAbs;
}

/**
 * Reconstrói o conteúdo remoto de um arquivo a partir do histórico remoto,
 * utilizando o último evento relevante encontrado para o caminho informado.
 *
 * No MVP atual, a leitura remota depende do histórico sincronizado e assume
 * conteúdo UTF-8 quando presente.
 *
 * @param provider Provider remoto usado para acessar o histórico.
 * @param filePath Caminho relativo do arquivo.
 * @returns Conteúdo remoto do arquivo ou string vazia quando não houver conteúdo aplicável.
 */
async function readRemoteFileFromHistory(
	provider: RemoteFolderSyncProvider,
	filePath: string,
) {
	const { events } = await provider.pullHistoryEvents(null);

	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		if (!ev) continue;
		if (ev.change.path !== filePath) continue;

		if (ev.change.changeType === "deleted") return "";

		if (ev.content && ev.encoding === "utf-8") return ev.content;

		return "";
	}

	return "";
}

/**
 * Cria a engine de sincronização para um vault específico.
 *
 * Essa função instancia todos os adapters e serviços necessários para
 * executar sincronização via pasta remota.
 *
 * @param args Configuração da engine.
 * @param args.vaultId Identificador do vault.
 * @param args.localPath Caminho absoluto do vault local.
 * @param args.remoteRootDir Diretório raiz remoto.
 * @returns Objetos necessários para executar sincronização e operações auxiliares.
 */
function createSyncEngine(args: {
	vaultId: string;
	localPath: string;
	remoteRootDir: string;
}) {
	const { vaultId, localPath, remoteRootDir } = args;

	const provider = new RemoteFolderSyncProvider(
		path.resolve(remoteRootDir),
		vaultId,
	);

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

/**
 * Registra os handlers IPC usados pela interface para consultar mudanças,
 * ler conteúdo de arquivos, salvar merges manuais, aceitar resoluções
 * e executar sincronização.
 *
 * @param win Janela principal da aplicação.
 */
function registerIpc(win: BrowserWindow) {
	ipcMain.handle("changes:list", async (_evt, args) => {
		const { vaultId } = (args ?? {}) as { vaultId?: unknown };
		if (typeof vaultId !== "string")
			throw new Error("Parâmetro inválido: vaultId");

		const { localPath } = requireLocalPath(vaultId);

		const stateStore = new NodeSyncStateStore();
		const allStates = await stateStore.loadAll(localPath);

		const result = compareAllStates(allStates) as unknown as {
			comparisons: FileComparisonLite[];
			conflicts: ConflictLite[];
		};

		const { comparisons, conflicts } = result;

		const conflictTypeByPath = new Map<string, string>(
			conflicts.map((conflict: ConflictLite) => [conflict.path, conflict.type]),
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

	ipcMain.handle("changes:readFileSide", async (_evt, args) => {
		const { vaultId, filePath, side, remoteRootDir } = (args ?? {}) as {
			vaultId?: unknown;
			filePath?: unknown;
			side?: unknown;
			remoteRootDir?: unknown;
		};

		if (typeof vaultId !== "string")
			throw new Error("Parâmetro inválido: vaultId");
		if (typeof filePath !== "string")
			throw new Error("Parâmetro inválido: filePath");
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

		if (
			typeof remoteRootDir !== "string" ||
			remoteRootDir.trim().length === 0
		) {
			throw new Error(
				"Parâmetro inválido: remoteRootDir (necessário para side=remote)",
			);
		}

		const { provider } = createSyncEngine({
			vaultId,
			localPath: requireLocalPath(vaultId).localPath,
			remoteRootDir,
		});

		return await readRemoteFileFromHistory(provider, filePath);
	});

	ipcMain.handle("changes:saveMerged", async (_evt, args) => {
		const { vaultId, filePath, content } = (args ?? {}) as {
			vaultId?: unknown;
			filePath?: unknown;
			content?: unknown;
		};

		if (typeof vaultId !== "string")
			throw new Error("Parâmetro inválido: vaultId");
		if (typeof filePath !== "string")
			throw new Error("Parâmetro inválido: filePath");
		if (typeof content !== "string")
			throw new Error("Parâmetro inválido: content");

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

		if (typeof vaultId !== "string")
			throw new Error("Parâmetro inválido: vaultId");
		if (typeof filePath !== "string")
			throw new Error("Parâmetro inválido: filePath");
		if (
			strategy !== "keep_local" &&
			strategy !== "keep_remote" &&
			strategy !== "manual_merge"
		) {
			throw new Error("Parâmetro inválido: strategy");
		}

		const { localPath } = requireLocalPath(vaultId);
		const decisionStore = new NodeConflictDecisionStore();

		const mapped: "local" | "remote" =
			strategy === "keep_remote" ? "remote" : "local";

		await decisionStore.set(localPath, {
			path: filePath.replaceAll("\\", "/"),
			strategy: mapped,
			decidedAtIso: new Date().toISOString(),
		});

		return { ok: true, strategy, filePath };
	});

	ipcMain.handle("sync:run", async (_evt, args) => {
		const { vaultId, mode, remoteRootDir, defaultStrategy } = (args ?? {}) as {
			vaultId?: unknown;
			mode?: unknown;
			remoteRootDir?: unknown;
			defaultStrategy?: unknown;
		};

		if (typeof vaultId !== "string")
			throw new Error("Parâmetro inválido: vaultId");
		if (mode !== "remote-folder")
			throw new Error("Parâmetro inválido: mode (use remote-folder)");
		if (
			typeof remoteRootDir !== "string" ||
			remoteRootDir.trim().length === 0
		) {
			throw new Error("Parâmetro inválido: remoteRootDir");
		}

		const { localPath } = requireLocalPath(vaultId);
		const strategy: "local" | "remote" =
			defaultStrategy === "remote" ? "remote" : "local";

		const engine = createSyncEngine({ vaultId, localPath, remoteRootDir });

		win.webContents.send("sync:status", {
			vaultId,
			status: "syncing",
			atIso: new Date().toISOString(),
		});

		try {
			const summary = (await engine.syncService.syncOnce({
				vaultRootAbs: localPath,
				defaultConflictStrategy: strategy,
			})) as SyncRunSummary;

			win.webContents.send("sync:status", {
				vaultId,
				status: summary.conflictsAfter > 0 ? "conflict" : "ok",
				atIso: new Date().toISOString(),
				summary,
			});

			return { ok: true, summary };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);

			win.webContents.send("sync:status", {
				vaultId,
				status: "error",
				atIso: new Date().toISOString(),
				error: message,
			});

			throw e;
		}
	});
}

/**
 * Cria a janela principal da aplicação Electron.
 *
 * @returns Instância da janela principal.
 */
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
