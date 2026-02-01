import type { OAuth2Client } from "google-auth-library";
import { google, drive_v3 } from "googleapis";

/**
 * Constantes
 */
const APP_ROOT_NAME = "mini-sync-obsidian";
const VAULTS_FOLDER_NAME = "vaults";
const HISTORY_FOLDER_NAME = "history";
const SNAPSHOTS_FOLDER_NAME = "snapshots";
const CURSOR_FILE_NAME = "cursor.json";
const META_FILE_NAME = "meta.json";

/**
 * Client do Drive
 * (no seu ambiente, o mais confiável é ter o auth no client e também poder passar em request quando quiser)
 */
function drive(auth: OAuth2Client): drive_v3.Drive {
  return google.drive({ version: "v3", auth });
}

function escapeQueryValue(v: string) {
  // Google Drive query usa aspas simples; precisamos escapar ' dentro do name
  return v.replace(/'/g, "\\'");
}

/**
 * Busca filho por nome dentro de um parentId.
 * Se mimeType for passado, filtra por mimeType.
 */
async function findChildByName(
  auth: OAuth2Client,
  parentId: string,
  name: string,
  mimeType?: string
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
 * Cria folder e retorna id
 */
async function createFolder(
  auth: OAuth2Client,
  parentId: string,
  name: string
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
 * Garante um folder dentro do parent e retorna o id (nunca null).
 */
export async function ensureFolder(
  auth: OAuth2Client,
  parentId: string,
  name: string
): Promise<string> {
  const found = await findChildByName(
    auth,
    parentId,
    name,
    "application/vnd.google-apps.folder"
  );
  if (found?.id) return found.id;

  return createFolder(auth, parentId, name);
}

/**
 * Cria arquivo texto e retorna id
 */
async function createTextFile(
  auth: OAuth2Client,
  parentId: string,
  name: string,
  content: string,
  mimeType = "text/plain"
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
 * Garante um arquivo (texto) dentro do parent e retorna o fileId.
 * Se não existir, cria com initialContent.
 */
export async function getOrCreateTextFile(
  auth: OAuth2Client,
  parentId: string,
  name: string,
  initialContent = "",
  mimeType = "text/plain"
): Promise<string> {
  const found = await findChildByName(auth, parentId, name);
  if (found?.id) return found.id;

  return createTextFile(auth, parentId, name, initialContent, mimeType);
}

/**
 * Baixa conteúdo como texto (alt=media).
 */
/**
 * Baixa conteúdo como texto (alt=media).
 */
export async function downloadText(
  auth: OAuth2Client,
  fileId: string
): Promise<string> {
  // Tipagem mínima (e estável) só para esse uso com alt=media.
  type FilesGet = (
    params: { fileId: string; alt?: "media" },
    options?: { responseType?: "text" }
  ) => Promise<{ data: unknown }>;

  const files = drive(auth).files as unknown as { get: FilesGet };

  const res = await files.get(
    { fileId, alt: "media" },
    { responseType: "text" }
  );

  return typeof res.data === "string" ? res.data : "";
}

/**
 * Sobrescreve arquivo com conteúdo (MVP).
 */
export async function uploadText(
  auth: OAuth2Client,
  fileId: string,
  content: string,
  mimeType = "text/plain"
): Promise<void> {
  await drive(auth).files.update({
    fileId,
    media: { mimeType, body: content },
  });
}

/**
 * Append em JSONL (MVP simples):
 * - baixa conteúdo atual
 * - concatena
 * - faz update
 *
 * (Depois a gente otimiza para reduzir download quando necessário.)
 */
export async function appendJsonl(
  auth: OAuth2Client,
  fileId: string,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return;

  const current = await downloadText(auth, fileId);

  const normalized = lines
    .map((l) => (l.endsWith("\n") ? l : l + "\n"))
    .join("");

  const next =
    current.length === 0
      ? normalized
      : current + (current.endsWith("\n") ? "" : "\n") + normalized;

  await uploadText(auth, fileId, next, "application/json");
}

/**
 * Pasta raiz do app (mini-sync-obsidian) no "Meu Drive".
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
 * Garante mini-sync-obsidian/vaults/<vaultId> e retorna o vaultFolderId
 */
export async function ensureVaultFolder(
  auth: OAuth2Client,
  vaultId: string
): Promise<string> {
  const appRootId = await ensureAppRootFolder(auth);
  const vaultsId = await ensureFolder(auth, appRootId, VAULTS_FOLDER_NAME);
  const vaultFolderId = await ensureFolder(auth, vaultsId, vaultId);
  return vaultFolderId;
}

/**
 * Conveniência: history/ dentro do vault
 */
export async function ensureHistoryFolder(
  auth: OAuth2Client,
  vaultFolderId: string
): Promise<string> {
  return ensureFolder(auth, vaultFolderId, HISTORY_FOLDER_NAME);
}

/**
 * Conveniência: snapshots/ dentro do vault (opcional)
 */
export async function ensureSnapshotsFolder(
  auth: OAuth2Client,
  vaultFolderId: string
): Promise<string> {
  return ensureFolder(auth, vaultFolderId, SNAPSHOTS_FOLDER_NAME);
}

/**
 * Conveniência: cursor.json dentro do vault
 */
export async function ensureCursorFile(
  auth: OAuth2Client,
  vaultFolderId: string
): Promise<string> {
  return getOrCreateTextFile(
    auth,
    vaultFolderId,
    CURSOR_FILE_NAME,
    JSON.stringify({ value: null }, null, 2),
    "application/json"
  );
}

/**
 * Conveniência: meta.json dentro do vault
 */
export async function ensureMetaFile(
  auth: OAuth2Client,
  vaultFolderId: string
): Promise<string> {
  return getOrCreateTextFile(
    auth,
    vaultFolderId,
    META_FILE_NAME,
    JSON.stringify({ schemaVersion: 1 }, null, 2),
    "application/json"
  );
}

/**
 * Conveniência: arquivo JSONL do dia dentro de history/
 * Ex: 2026-01-12.jsonl
 */
export async function ensureDailyHistoryFile(
  auth: OAuth2Client,
  historyFolderId: string,
  yyyyMmDd: string
): Promise<string> {
  const name = `${yyyyMmDd}.jsonl`;
  return getOrCreateTextFile(auth, historyFolderId, name, "", "application/json");
}
