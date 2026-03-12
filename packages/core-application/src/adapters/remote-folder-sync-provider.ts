import fs from "node:fs/promises";
import path from "node:path";

import type {
	BlobKey,
	SnapshotKey,
	SyncCursor,
	SyncProvider,
} from "../ports/sync-provider";
import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";

/**
 * Converte um cursor textual no formato `YYYY-MM-DD:line`
 * para uma estrutura utilizável internamente.
 *
 * @param cursor Cursor remoto atual.
 * @returns Data e linha do cursor ou `null` quando inválido.
 */
function parseCursor(
	cursor: SyncCursor | null,
): { date: string; line: number } | null {
	if (!cursor) return null;

	const [date, lineStr] = cursor.value.split(":");
	const line = Number(lineStr);

	if (!date || Number.isNaN(line)) return null;

	return { date, line };
}

/**
 * Cria um cursor textual a partir de data e índice da linha.
 *
 * @param date Data do arquivo JSONL.
 * @param line Índice da última linha processada.
 * @returns Cursor remoto serializado.
 */
function makeCursor(date: string, line: number): SyncCursor {
	return { value: `${date}:${line}` };
}

/**
 * Extrai a data `YYYY-MM-DD` de um timestamp ISO.
 *
 * @param iso Timestamp em formato ISO-8601.
 * @returns Data no formato `YYYY-MM-DD`.
 */
function dateFromIso(iso: string): string {
	return iso.slice(0, 10);
}

/**
 * Verifica se um caminho existe no filesystem.
 *
 * @param p Caminho absoluto.
 * @returns `true` quando o caminho existe.
 */
async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Verifica se o processo atual está executando em Windows.
 *
 * @returns `true` quando a plataforma é Windows.
 */
function isWindows(): boolean {
	return process.platform === "win32";
}

/**
 * Normaliza o diretório raiz remoto.
 *
 * Mantém compatibilidade com:
 * - caminhos UNC
 * - caminhos locais normais
 * - letras de drive no Windows
 *
 * @param input Caminho bruto informado ao provider.
 * @returns Caminho normalizado.
 */
function normalizeRemoteRoot(input: string): string {
	let p = input.trim();

	if (
		(p.startsWith('"') && p.endsWith('"')) ||
		(p.startsWith("'") && p.endsWith("'"))
	) {
		p = p.slice(1, -1);
	}

	if (isWindows() && /^[a-zA-Z]:$/.test(p)) {
		p = `${p}\\`;
	}

	return path.normalize(p);
}

/**
 * Implementação de `SyncProvider` baseada em pasta remota compartilhada.
 *
 * Estrutura remota esperada:
 *
 * ```txt
 * <remoteRoot>/MiniSync/<vaultId>/
 *   history/
 *     YYYY-MM-DD.jsonl
 *   snapshots/
 *     <snapshotId>.json
 *   attachments/
 *     <sha256>
 *   meta.json
 *   cursor.json
 * ```
 *
 * Esse provider oferece um backend de sincronização baseado em filesystem,
 * ideal para ambientes locais, rede compartilhada e MVPs sem necessidade
 * de API remota dedicada.
 */
export class RemoteFolderSyncProvider implements SyncProvider {
	/**
	 * Diretório raiz remoto normalizado.
	 */
	private readonly remoteRootDir: string;

	/**
	 * Cria uma nova instância do provider de pasta remota.
	 *
	 * @param remoteRootDir Diretório raiz remoto configurado.
	 * @param vaultId Identificador do vault sincronizado.
	 */
	constructor(
		remoteRootDir: string,
		private readonly vaultId: string,
	) {
		this.remoteRootDir = normalizeRemoteRoot(remoteRootDir);
	}

	/**
	 * Retorna o diretório raiz do Mini Sync no destino remoto.
	 */
	private appRootDir(): string {
		return path.join(this.remoteRootDir, "MiniSync");
	}

	/**
	 * Retorna o diretório remoto do vault atual.
	 */
	private vaultRootDir(): string {
		return path.join(this.appRootDir(), this.vaultId);
	}

	/**
	 * Retorna o diretório remoto de histórico do vault.
	 */
	private historyDir(): string {
		return path.join(this.vaultRootDir(), "history");
	}

	/**
	 * Retorna o diretório remoto de snapshots do vault.
	 */
	private snapshotsDir(): string {
		return path.join(this.vaultRootDir(), "snapshots");
	}

	/**
	 * Retorna o diretório remoto de anexos/blobs do vault.
	 */
	private attachmentsDir(): string {
		return path.join(this.vaultRootDir(), "attachments");
	}

	/**
	 * Retorna o caminho de um arquivo diário de histórico.
	 *
	 * @param date Data no formato `YYYY-MM-DD`.
	 */
	private historyFile(date: string): string {
		return path.join(this.historyDir(), `${date}.jsonl`);
	}

	/**
	 * Retorna o caminho do arquivo de metadados do vault remoto.
	 */
	private metaFile(): string {
		return path.join(this.vaultRootDir(), "meta.json");
	}

	/**
	 * Retorna o caminho do arquivo de cursor remoto.
	 */
	private cursorFile(): string {
		return path.join(this.vaultRootDir(), "cursor.json");
	}

	/**
	 * Retorna o caminho do manifest de snapshot remoto.
	 *
	 * @param id Identificador do snapshot.
	 */
	private snapshotManifestPath(id: string): string {
		return path.join(this.snapshotsDir(), `${id}.json`);
	}

	/**
	 * Retorna o caminho de um attachment/blob remoto.
	 *
	 * @param sha256 Hash SHA-256 do blob.
	 */
	private attachmentPath(sha256: string): string {
		return path.join(this.attachmentsDir(), sha256);
	}

	/**
	 * Garante que o diretório raiz remoto está acessível.
	 *
	 * Em Windows, valida explicitamente a disponibilidade de drives mapeados.
	 *
	 * @throws Error Quando o root remoto não está acessível.
	 */
	private async assertRemoteRootAccessible(): Promise<void> {
		if (isWindows()) {
			const m = /^([a-zA-Z]):\\/.exec(this.remoteRootDir);

			if (m) {
				const driveRoot = `${m[1]}:\\`;

				try {
					await fs.stat(driveRoot);
				} catch {
					throw new Error(
						`Remote root inacessível: "${this.remoteRootDir}". O drive "${driveRoot}" não está disponível para este processo. Dica: prefira usar o caminho UNC (ex.: "\\\\PC-A\\\\MiniSyncRemote") em vez de drive mapeado (Z:).`,
					);
				}
			}
		}
	}

	/**
	 * Garante a existência de toda a estrutura remota do provider.
	 *
	 * Também inicializa `meta.json` e `cursor.json` quando ausentes.
	 */
	private async ensureStructure(): Promise<void> {
		await this.assertRemoteRootAccessible();

		await fs.mkdir(this.remoteRootDir, { recursive: true });
		await fs.mkdir(this.appRootDir(), { recursive: true });
		await fs.mkdir(this.vaultRootDir(), { recursive: true });

		await fs.mkdir(this.historyDir(), { recursive: true });
		await fs.mkdir(this.snapshotsDir(), { recursive: true });
		await fs.mkdir(this.attachmentsDir(), { recursive: true });

		const metaPath = this.metaFile();
		if (!(await exists(metaPath))) {
			const meta = {
				version: 1,
				provider: "remote-folder",
				vaultId: this.vaultId,
				createdAtIso: new Date().toISOString(),
			};

			await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
		}

		const cursorPath = this.cursorFile();
		if (!(await exists(cursorPath))) {
			const payload = { value: null as string | null };
			await fs.writeFile(
				cursorPath,
				JSON.stringify(payload, null, 2),
				"utf-8",
			);
		}
	}

	/**
	 * Envia eventos de histórico para o repositório remoto.
	 *
	 * Os eventos são agrupados por dia e armazenados em arquivos JSONL.
	 *
	 * @param events Eventos a serem persistidos remotamente.
	 */
	async pushHistoryEvents(events: HistoryEvent[]): Promise<void> {
		if (events.length === 0) return;

		await this.ensureStructure();

		const byDate = new Map<string, HistoryEvent[]>();

		for (const event of events) {
			const date = dateFromIso(event.occurredAtIso);
			const list = byDate.get(date) ?? [];
			list.push(event);
			byDate.set(date, list);
		}

		for (const [date, list] of byDate.entries()) {
			const filePath = this.historyFile(date);
			const lines = `${list.map((event) => JSON.stringify(event)).join("\n")}\n`;

			await fs.appendFile(filePath, lines, "utf-8");
		}
	}

	/**
	 * Lê eventos de histórico remotos a partir do cursor informado.
	 *
	 * O cursor controla a posição do último evento já processado
	 * dentro dos arquivos diários JSONL.
	 *
	 * @param cursor Cursor remoto atual.
	 * @returns Eventos novos e próximo cursor calculado.
	 */
	async pullHistoryEvents(
		cursor: SyncCursor | null,
	): Promise<{ events: HistoryEvent[]; nextCursor: SyncCursor | null }> {
		await this.ensureStructure();

		const cur = parseCursor(cursor);
		const files = (await fs.readdir(this.historyDir()))
			.filter((file) => file.endsWith(".jsonl"))
			.sort();

		const events: HistoryEvent[] = [];
		let lastDate: string | null = null;
		let lastLine = -1;

		for (const file of files) {
			const date = file.replace(".jsonl", "");
			if (cur && date < cur.date) continue;

			const content = await fs.readFile(
				path.join(this.historyDir(), file),
				"utf-8",
			);

			const lines = content.split("\n").filter((line) => line.trim().length > 0);
			const startLine = cur && date === cur.date ? cur.line + 1 : 0;

			for (let i = startLine; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;

				try {
					const parsed = JSON.parse(line) as HistoryEvent;
					events.push(parsed);
					lastDate = date;
					lastLine = i;
				} catch {}
			}
		}

		if (lastDate === null) {
			return { events: [], nextCursor: cursor };
		}

		return {
			events,
			nextCursor: makeCursor(lastDate, lastLine),
		};
	}

	/**
	 * Verifica se um blob remoto existe.
	 *
	 * @param key Chave do blob.
	 * @returns `true` quando o blob existe.
	 */
	async hasBlob(key: BlobKey): Promise<boolean> {
		await this.ensureStructure();
		return exists(this.attachmentPath(key.sha256));
	}

	/**
	 * Armazena um blob remoto no diretório de attachments.
	 *
	 * Se já existir um blob com o mesmo hash, nada é feito.
	 *
	 * @param key Chave do blob.
	 * @param data Conteúdo binário do blob.
	 */
	async putBlob(key: BlobKey, data: Buffer): Promise<void> {
		await this.ensureStructure();

		const filePath = this.attachmentPath(key.sha256);

		if (await exists(filePath)) return;

		await fs.writeFile(filePath, data);
	}

	/**
	 * Recupera um blob remoto.
	 *
	 * @param key Chave do blob.
	 * @returns Conteúdo binário do blob.
	 */
	async getBlob(key: BlobKey): Promise<Buffer> {
		await this.ensureStructure();
		return fs.readFile(this.attachmentPath(key.sha256));
	}

	/**
	 * Lista todos os snapshots disponíveis no backend remoto.
	 *
	 * @returns Lista de chaves de snapshots ordenadas.
	 */
	async listSnapshots(): Promise<SnapshotKey[]> {
		await this.ensureStructure();

		const files = (await fs.readdir(this.snapshotsDir()))
			.filter((file) => file.endsWith(".json"))
			.sort();

		return files.map((file) => ({ id: file.replace(".json", "") }));
	}

	/**
	 * Persiste o manifest de um snapshot remoto.
	 *
	 * @param key Chave do snapshot.
	 * @param manifest Manifest do snapshot.
	 */
	async putSnapshotManifest(
		key: SnapshotKey,
		manifest: SnapshotManifest,
	): Promise<void> {
		await this.ensureStructure();

		await fs.writeFile(
			this.snapshotManifestPath(key.id),
			JSON.stringify(manifest, null, 2),
			"utf-8",
		);
	}

	/**
	 * Recupera o manifest de um snapshot remoto.
	 *
	 * @param key Chave do snapshot.
	 * @returns Manifest do snapshot.
	 */
	async getSnapshotManifest(key: SnapshotKey): Promise<SnapshotManifest> {
		await this.ensureStructure();

		const raw = await fs.readFile(
			this.snapshotManifestPath(key.id),
			"utf-8",
		);

		return JSON.parse(raw) as SnapshotManifest;
	}
}