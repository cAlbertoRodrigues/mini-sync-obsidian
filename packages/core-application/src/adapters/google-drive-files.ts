import type { OAuth2Client } from "google-auth-library";
import { type drive_v3, google } from "googleapis";

/**
 * Nome da pasta raiz do aplicativo no Google Drive.
 */
const APP_ROOT_NAME = "mini-sync-obsidian";

/**
 * Nome da pasta que agrupa os vaults sincronizados.
 */
const VAULTS_FOLDER_NAME = "vaults";

/**
 * Nome da pasta que armazena histórico remoto.
 */
const HISTORY_FOLDER_NAME = "history";

/**
 * Nome da pasta que armazena snapshots remotos.
 */
const SNAPSHOTS_FOLDER_NAME = "snapshots";

/**
 * Nome do arquivo de cursor do vault remoto.
 */
const CURSOR_FILE_NAME = "cursor.json";

/**
 * Nome do arquivo de metadados do vault remoto.
 */
const META_FILE_NAME = "meta.json";

/**
 * Cria um cliente autenticado da API do Google Drive.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @returns Cliente do Google Drive v3.
 */
function drive(auth: OAuth2Client): drive_v3.Drive {
	return google.drive({ version: "v3", auth });
}

/**
 * Escapa valores usados em queries do Google Drive.
 *
 * A linguagem de consulta usa aspas simples para strings,
 * portanto aspas simples no valor precisam ser escapadas.
 *
 * @param v Valor bruto a ser inserido na query.
 * @returns Valor escapado para uso seguro em queries.
 */
function escapeQueryValue(v: string) {
	return v.replace(/'/g, "\\'");
}

/**
 * Busca um arquivo ou pasta filha pelo nome dentro de um diretório pai.
 *
 * Opcionalmente filtra também pelo `mimeType`.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param parentId Identificador da pasta pai.
 * @param name Nome do item procurado.
 * @param mimeType Tipo MIME opcional para filtrar o resultado.
 * @returns Primeiro item encontrado ou `null`.
 */
async function findChildByName(
	auth: OAuth2Client,
	parentId: string,
	name: string,
	mimeType?: string,
): Promise<drive_v3.Schema$File | null> {
	const q = [
		`'${parentId}' in parents`,
		`name = '${escapeQueryValue(name)}'`,
		"trashed = false",
		mimeType ? `mimeType = '${mimeType}'` : null,
	]
		.filter(Boolean)
		.join(" and ");

	const res = await drive(auth).files.list({
		q,
		pageSize: 1,
		fields: "files(id,name,mimeType,modifiedTime,size)",
		spaces: "drive",
	});

	return res.data.files?.[0] ?? null;
}

/**
 * Cria uma pasta dentro de um diretório pai.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param parentId Identificador da pasta pai.
 * @param name Nome da nova pasta.
 * @returns Identificador da pasta criada.
 * @throws Error Quando a API não retorna um id.
 */
async function createFolder(
	auth: OAuth2Client,
	parentId: string,
	name: string,
): Promise<string> {
	const res = await drive(auth).files.create({
		requestBody: {
			name,
			mimeType: "application/vnd.google-apps.folder",
			parents: [parentId],
		},
		fields: "id",
	});

	const id = res.data.id;
	if (!id) throw new Error(`Falha ao criar pasta "${name}" no Google Drive`);
	return id;
}

/**
 * Garante a existência de uma pasta dentro do diretório pai.
 *
 * Se a pasta já existir, retorna seu id. Caso contrário, cria e retorna o novo id.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param parentId Identificador da pasta pai.
 * @param name Nome da pasta.
 * @returns Identificador da pasta garantida.
 */
export async function ensureFolder(
	auth: OAuth2Client,
	parentId: string,
	name: string,
): Promise<string> {
	const found = await findChildByName(
		auth,
		parentId,
		name,
		"application/vnd.google-apps.folder",
	);
	if (found?.id) return found.id;

	return createFolder(auth, parentId, name);
}

/**
 * Cria um arquivo de texto dentro de um diretório pai.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param parentId Identificador da pasta pai.
 * @param name Nome do arquivo.
 * @param content Conteúdo inicial do arquivo.
 * @param mimeType Tipo MIME do arquivo.
 * @returns Identificador do arquivo criado.
 * @throws Error Quando a API não retorna um id.
 */
async function createTextFile(
	auth: OAuth2Client,
	parentId: string,
	name: string,
	content: string,
	mimeType = "text/plain",
): Promise<string> {
	const res = await drive(auth).files.create({
		requestBody: { name, parents: [parentId] },
		media: { mimeType, body: content },
		fields: "id",
	});

	const id = res.data.id;
	if (!id) throw new Error(`Falha ao criar arquivo "${name}" no Google Drive`);
	return id;
}

/**
 * Garante a existência de um arquivo de texto dentro do diretório pai.
 *
 * Se já existir, retorna seu id. Caso contrário, cria o arquivo
 * usando `initialContent`.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param parentId Identificador da pasta pai.
 * @param name Nome do arquivo.
 * @param initialContent Conteúdo inicial do arquivo caso ele não exista.
 * @param mimeType Tipo MIME do arquivo.
 * @returns Identificador do arquivo garantido.
 */
export async function getOrCreateTextFile(
	auth: OAuth2Client,
	parentId: string,
	name: string,
	initialContent = "",
	mimeType = "text/plain",
): Promise<string> {
	const found = await findChildByName(auth, parentId, name);
	if (found?.id) return found.id;

	return createTextFile(auth, parentId, name, initialContent, mimeType);
}

/**
 * Baixa o conteúdo textual de um arquivo do Google Drive.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param fileId Identificador do arquivo.
 * @returns Conteúdo do arquivo como texto.
 */
export async function downloadText(
	auth: OAuth2Client,
	fileId: string,
): Promise<string> {
	type FilesGet = (
		params: { fileId: string; alt?: "media" },
		options?: { responseType?: "text" },
	) => Promise<{ data: unknown }>;

	const files = drive(auth).files as unknown as { get: FilesGet };

	const res = await files.get(
		{ fileId, alt: "media" },
		{ responseType: "text" },
	);

	return typeof res.data === "string" ? res.data : "";
}

/**
 * Sobrescreve o conteúdo de um arquivo de texto no Google Drive.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param fileId Identificador do arquivo.
 * @param content Novo conteúdo do arquivo.
 * @param mimeType Tipo MIME a ser enviado.
 */
export async function uploadText(
	auth: OAuth2Client,
	fileId: string,
	content: string,
	mimeType = "text/plain",
): Promise<void> {
	await drive(auth).files.update({
		fileId,
		media: { mimeType, body: content },
	});
}

/**
 * Anexa novas linhas a um arquivo JSONL remoto.
 *
 * Implementação atual do MVP:
 * - baixa o conteúdo atual
 * - concatena as novas linhas
 * - sobrescreve o arquivo completo
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param fileId Identificador do arquivo JSONL.
 * @param lines Linhas a serem anexadas.
 */
export async function appendJsonl(
	auth: OAuth2Client,
	fileId: string,
	lines: string[],
): Promise<void> {
	if (lines.length === 0) return;

	const current = await downloadText(auth, fileId);

	const normalized = lines
		.map((l) => (l.endsWith("\n") ? l : `${l}\n`))
		.join("");

	const next =
		current.length === 0
			? normalized
			: `${current}${current.endsWith("\n") ? "" : "\n"}${normalized}`;

	await uploadText(auth, fileId, next, "application/json");
}

/**
 * Garante a pasta raiz do aplicativo no Google Drive.
 *
 * A estrutura esperada é criada diretamente no "Meu Drive".
 *
 * @param auth Cliente OAuth2 autenticado.
 * @returns Identificador da pasta raiz do app.
 */
export async function ensureAppRootFolder(auth: OAuth2Client): Promise<string> {
	const res = await drive(auth).files.list({
		q: [
			"trashed = false",
			`name = '${APP_ROOT_NAME}'`,
			"mimeType = 'application/vnd.google-apps.folder'",
			"'root' in parents",
		].join(" and "),
		pageSize: 1,
		fields: "files(id,name)",
		spaces: "drive",
	});

	const existing = res.data.files?.[0];
	if (existing?.id) return existing.id;

	return createFolder(auth, "root", APP_ROOT_NAME);
}

/**
 * Garante a estrutura `mini-sync-obsidian/vaults/<vaultId>`.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param vaultId Identificador do vault.
 * @returns Identificador da pasta do vault.
 */
export async function ensureVaultFolder(
	auth: OAuth2Client,
	vaultId: string,
): Promise<string> {
	const appRootId = await ensureAppRootFolder(auth);
	const vaultsId = await ensureFolder(auth, appRootId, VAULTS_FOLDER_NAME);
	const vaultFolderId = await ensureFolder(auth, vaultsId, vaultId);
	return vaultFolderId;
}

/**
 * Garante a pasta `history` dentro da pasta de um vault.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param vaultFolderId Identificador da pasta do vault.
 * @returns Identificador da pasta de histórico.
 */
export async function ensureHistoryFolder(
	auth: OAuth2Client,
	vaultFolderId: string,
): Promise<string> {
	return ensureFolder(auth, vaultFolderId, HISTORY_FOLDER_NAME);
}

/**
 * Garante a pasta `snapshots` dentro da pasta de um vault.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param vaultFolderId Identificador da pasta do vault.
 * @returns Identificador da pasta de snapshots.
 */
export async function ensureSnapshotsFolder(
	auth: OAuth2Client,
	vaultFolderId: string,
): Promise<string> {
	return ensureFolder(auth, vaultFolderId, SNAPSHOTS_FOLDER_NAME);
}

/**
 * Garante a existência do arquivo `cursor.json` dentro do vault remoto.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param vaultFolderId Identificador da pasta do vault.
 * @returns Identificador do arquivo de cursor.
 */
export async function ensureCursorFile(
	auth: OAuth2Client,
	vaultFolderId: string,
): Promise<string> {
	return getOrCreateTextFile(
		auth,
		vaultFolderId,
		CURSOR_FILE_NAME,
		JSON.stringify({ value: null }, null, 2),
		"application/json",
	);
}

/**
 * Garante a existência do arquivo `meta.json` dentro do vault remoto.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param vaultFolderId Identificador da pasta do vault.
 * @returns Identificador do arquivo de metadados.
 */
export async function ensureMetaFile(
	auth: OAuth2Client,
	vaultFolderId: string,
): Promise<string> {
	return getOrCreateTextFile(
		auth,
		vaultFolderId,
		META_FILE_NAME,
		JSON.stringify({ schemaVersion: 1 }, null, 2),
		"application/json",
	);
}

/**
 * Garante o arquivo JSONL diário dentro da pasta `history`.
 *
 * Exemplo de nome esperado: `2026-01-12.jsonl`.
 *
 * @param auth Cliente OAuth2 autenticado.
 * @param historyFolderId Identificador da pasta `history`.
 * @param yyyyMmDd Data do arquivo no formato `YYYY-MM-DD`.
 * @returns Identificador do arquivo diário de histórico.
 */
export async function ensureDailyHistoryFile(
	auth: OAuth2Client,
	historyFolderId: string,
	yyyyMmDd: string,
): Promise<string> {
	const name = `${yyyyMmDd}.jsonl`;
	return getOrCreateTextFile(
		auth,
		historyFolderId,
		name,
		"",
		"application/json",
	);
}
