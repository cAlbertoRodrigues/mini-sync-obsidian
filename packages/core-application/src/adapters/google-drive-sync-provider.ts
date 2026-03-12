import type { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";

import type {
	BlobKey,
	SnapshotKey,
	SyncCursor,
	SyncProvider,
} from "../ports/sync-provider";
import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";

import { createDriveClient } from "./google-drive-client";
import {
	appendJsonl,
	downloadText,
	ensureCursorFile,
	ensureDailyHistoryFile,
	ensureFolder,
	ensureHistoryFolder,
	ensureSnapshotsFolder,
	ensureVaultFolder,
	uploadText,
} from "./google-drive-files";

/**
 * Implementação de `SyncProvider` baseada em Google Drive.
 *
 * Estrutura remota utilizada:
 *
 * ```txt
 * mini-sync-obsidian/
 *   vaults/
 *     <vaultId>/
 *       history/
 *         YYYY-MM-DD.jsonl
 *       cursor.json
 *       snapshots/
 *         <snapshotId>.json
 *       blobs/
 *         <sha256>
 * ```
 */
export class GoogleDriveSyncProvider implements SyncProvider {
	/**
	 * Cliente autenticado do Google Drive.
	 */
	private readonly drive: drive_v3.Drive;

	/**
	 * Nome da pasta onde blobs são armazenados dentro do vault remoto.
	 */
	private static readonly BLOBS_FOLDER_NAME = "blobs";

	/**
	 * Cria uma nova instância do provider de Google Drive.
	 *
	 * @param auth Cliente OAuth2 autenticado.
	 * @param vaultId Identificador do vault remoto.
	 */
	constructor(
		private readonly auth: OAuth2Client,
		private readonly vaultId: string,
	) {
		this.drive = createDriveClient(auth);
	}

	/**
	 * Atualiza explicitamente o cursor remoto do vault.
	 *
	 * @param cursor Novo cursor remoto ou `null`.
	 */
	public async setRemoteCursor(cursor: SyncCursor | null): Promise<void> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		await this.writeRemoteCursor(vaultFolderId, cursor);
	}

	/**
	 * Lê o cursor remoto persistido no vault.
	 *
	 * @param vaultFolderId Identificador da pasta do vault.
	 * @returns Cursor remoto atual ou `null`.
	 */
	private async readRemoteCursor(
		vaultFolderId: string,
	): Promise<SyncCursor | null> {
		const cursorFileId = await ensureCursorFile(this.auth, vaultFolderId);
		const raw = await downloadText(this.auth, cursorFileId);

		try {
			const parsed = JSON.parse(raw);
			return parsed?.value ? { value: String(parsed.value) } : null;
		} catch {
			return null;
		}
	}

	/**
	 * Persiste o cursor remoto do vault.
	 *
	 * @param vaultFolderId Identificador da pasta do vault.
	 * @param cursor Cursor a ser salvo.
	 */
	private async writeRemoteCursor(
		vaultFolderId: string,
		cursor: SyncCursor | null,
	): Promise<void> {
		const cursorFileId = await ensureCursorFile(this.auth, vaultFolderId);

		await uploadText(
			this.auth,
			cursorFileId,
			JSON.stringify({ value: cursor?.value ?? null }, null, 2),
			"application/json",
		);
	}

	/**
	 * Busca eventos de histórico remotos posteriores ao cursor informado.
	 *
	 * @param cursor Cursor da última sincronização conhecida.
	 * @returns Eventos remotos e o próximo cursor calculado.
	 */
	public async pullHistoryEvents(
		cursor: SyncCursor | null,
	): Promise<{ events: HistoryEvent[]; nextCursor: SyncCursor | null }> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const historyFolderId = await ensureHistoryFolder(this.auth, vaultFolderId);

		const baseIso = cursor?.value ?? null;
		const events: HistoryEvent[] = [];

		let pageToken: string | undefined;

		do {
			const res: drive_v3.Schema$FileList = (
				await this.drive.files.list({
					q: [
						`'${historyFolderId}' in parents`,
						"mimeType != 'application/vnd.google-apps.folder'",
						"trashed = false",
					].join(" and "),
					fields: "nextPageToken, files(id,name)",
					spaces: "drive",
					pageSize: 1000,
					pageToken,
				})
			).data;

			const files = (res.files ?? []).filter(
				(file) => file.name?.endsWith(".jsonl"),
			);

			for (const file of files) {
				if (!file.id || !file.name) continue;

				const content = await downloadText(this.auth, file.id);
				const lines = content.split("\n").filter(Boolean);

				for (const line of lines) {
					try {
						const event = JSON.parse(line) as HistoryEvent;
						if (!baseIso || event.occurredAtIso > baseIso) {
							events.push(event);
						}
					} catch {}
				}
			}

			pageToken = res.nextPageToken ?? undefined;
		} while (pageToken);

		if (events.length === 0) {
			return { events: [], nextCursor: cursor };
		}

		events.sort((a, b) => (a.occurredAtIso < b.occurredAtIso ? -1 : 1));

		const lastEvent = events.at(-1);
		const nextCursor = lastEvent
			? { value: lastEvent.occurredAtIso }
			: cursor;

		return {
			events,
			nextCursor,
		};
	}

	/**
	 * Envia eventos de histórico para o repositório remoto.
	 *
	 * @param events Eventos a serem enviados.
	 */
	public async pushHistoryEvents(events: HistoryEvent[]): Promise<void> {
		if (events.length === 0) return;

		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const historyFolderId = await ensureHistoryFolder(this.auth, vaultFolderId);

		const byDay = new Map<string, HistoryEvent[]>();

		for (const event of events) {
			const day = event.occurredAtIso.slice(0, 10);
			const list = byDay.get(day) ?? [];
			list.push(event);
			byDay.set(day, list);
		}

		for (const [day, list] of byDay.entries()) {
			const fileId = await ensureDailyHistoryFile(
				this.auth,
				historyFolderId,
				day,
			);

			const lines = list.map((event) => JSON.stringify(event));
			await appendJsonl(this.auth, fileId, lines);
		}

		const lastEvent = events.at(-1);
		if (lastEvent) {
			await this.writeRemoteCursor(vaultFolderId, {
				value: lastEvent.occurredAtIso,
			});
		}
	}

	/**
	 * Garante a pasta de blobs dentro do vault remoto.
	 *
	 * @param vaultFolderId Identificador da pasta do vault.
	 * @returns Identificador da pasta de blobs.
	 */
	private async ensureBlobsFolder(vaultFolderId: string): Promise<string> {
		return ensureFolder(
			this.auth,
			vaultFolderId,
			GoogleDriveSyncProvider.BLOBS_FOLDER_NAME,
		);
	}

	/**
	 * Escapa um valor para uso em query da API do Google Drive.
	 *
	 * @param value Valor bruto.
	 * @returns Valor escapado.
	 */
	private escapeQueryValue(value: string): string {
		return value.replace(/'/g, "\\'");
	}

	/**
	 * Busca o id de um arquivo filho pelo nome dentro de uma pasta pai.
	 *
	 * @param parentId Identificador da pasta pai.
	 * @param name Nome do arquivo procurado.
	 * @returns Identificador do arquivo ou `null`.
	 */
	private async findChildFileIdByName(
		parentId: string,
		name: string,
	): Promise<string | null> {
		const q = [
			`'${parentId}' in parents`,
			`name = '${this.escapeQueryValue(name)}'`,
			"trashed = false",
		].join(" and ");

		const res = await this.drive.files.list({
			q,
			pageSize: 1,
			fields: "files(id,name)",
			spaces: "drive",
		});

		return res.data.files?.[0]?.id ?? null;
	}

	/**
	 * Baixa o conteúdo binário de um arquivo remoto.
	 *
	 * @param fileId Identificador do arquivo.
	 * @returns Conteúdo binário em `Buffer`.
	 */
	private async downloadBytes(fileId: string): Promise<Buffer> {
		type FilesGet = (
			params: { fileId: string; alt?: "media" },
			options?: { responseType?: "arraybuffer" },
		) => Promise<{ data: ArrayBuffer }>;

		const files = this.drive.files as unknown as { get: FilesGet };

		const res = await files.get(
			{ fileId, alt: "media" },
			{ responseType: "arraybuffer" },
		);

		return Buffer.from(new Uint8Array(res.data));
	}

	/**
	 * Sobrescreve um arquivo remoto com conteúdo binário.
	 *
	 * @param fileId Identificador do arquivo.
	 * @param data Conteúdo binário.
	 * @param mimeType Tipo MIME enviado para a API.
	 */
	private async uploadBytes(
		fileId: string,
		data: Buffer,
		mimeType = "application/octet-stream",
	): Promise<void> {
		await this.drive.files.update({
			fileId,
			media: { mimeType, body: data as unknown as NodeJS.ReadableStream },
		});
	}

	/**
	 * Verifica se um blob existe remotamente.
	 *
	 * @param key Chave do blob.
	 * @returns `true` quando o blob existe.
	 */
	public async hasBlob(key: BlobKey): Promise<boolean> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

		const fileId = await this.findChildFileIdByName(blobsFolderId, key.sha256);
		return Boolean(fileId);
	}

	/**
	 * Armazena um blob remoto.
	 *
	 * @param key Chave do blob.
	 * @param data Conteúdo binário do blob.
	 */
	public async putBlob(key: BlobKey, data: Buffer): Promise<void> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

		const existingId = await this.findChildFileIdByName(
			blobsFolderId,
			key.sha256,
		);

		if (existingId) {
			await this.uploadBytes(existingId, data);
			return;
		}

		const created = await this.drive.files.create({
			requestBody: {
				name: key.sha256,
				parents: [blobsFolderId],
			},
			media: {
				mimeType: "application/octet-stream",
				body: data as unknown as NodeJS.ReadableStream,
			},
			fields: "id",
		});

		if (!created.data.id) {
			throw new Error("Falha ao criar blob no Google Drive");
		}
	}

	/**
	 * Recupera um blob remoto.
	 *
	 * @param key Chave do blob.
	 * @returns Conteúdo binário do blob.
	 */
	public async getBlob(key: BlobKey): Promise<Buffer> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

		const fileId = await this.findChildFileIdByName(blobsFolderId, key.sha256);
		if (!fileId) {
			throw new Error(`Blob não encontrado no Drive: ${key.sha256}`);
		}

		return this.downloadBytes(fileId);
	}

	/**
	 * Lista os snapshots disponíveis remotamente.
	 *
	 * @returns Lista de chaves de snapshot ordenadas pelo id.
	 */
	public async listSnapshots(): Promise<SnapshotKey[]> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const snapshotsFolderId = await ensureSnapshotsFolder(
			this.auth,
			vaultFolderId,
		);

		const res = await this.drive.files.list({
			q: [
				`'${snapshotsFolderId}' in parents`,
				"mimeType != 'application/vnd.google-apps.folder'",
				"trashed = false",
			].join(" and "),
			fields: "files(id,name)",
			spaces: "drive",
			pageSize: 1000,
		});

		const keys: SnapshotKey[] = [];

		for (const file of res.data.files ?? []) {
			if (!file.name?.endsWith(".json")) continue;

			const id = file.name.slice(0, -".json".length);
			if (id) {
				keys.push({ id });
			}
		}

		keys.sort((a, b) => (a.id < b.id ? -1 : 1));
		return keys;
	}

	/**
	 * Salva ou atualiza o manifest de um snapshot remoto.
	 *
	 * @param key Chave do snapshot.
	 * @param manifest Manifest a ser persistido.
	 */
	public async putSnapshotManifest(
		key: SnapshotKey,
		manifest: SnapshotManifest,
	): Promise<void> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const snapshotsFolderId = await ensureSnapshotsFolder(
			this.auth,
			vaultFolderId,
		);

		const name = `${key.id}.json`;
		const existingId = await this.findChildFileIdByName(
			snapshotsFolderId,
			name,
		);

		const content = JSON.stringify(manifest, null, 2);

		if (existingId) {
			await uploadText(this.auth, existingId, content, "application/json");
			return;
		}

		const created = await this.drive.files.create({
			requestBody: {
				name,
				parents: [snapshotsFolderId],
			},
			media: {
				mimeType: "application/json",
				body: content,
			},
			fields: "id",
		});

		if (!created.data.id) {
			throw new Error("Falha ao criar snapshot manifest no Google Drive");
		}
	}

	/**
	 * Recupera o manifest de um snapshot remoto.
	 *
	 * @param key Chave do snapshot.
	 * @returns Manifest do snapshot.
	 */
	public async getSnapshotManifest(
		key: SnapshotKey,
	): Promise<SnapshotManifest> {
		const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
		const snapshotsFolderId = await ensureSnapshotsFolder(
			this.auth,
			vaultFolderId,
		);

		const name = `${key.id}.json`;
		const fileId = await this.findChildFileIdByName(snapshotsFolderId, name);

		if (!fileId) {
			throw new Error(`Snapshot manifest não encontrado: ${key.id}`);
		}

		const raw = await downloadText(this.auth, fileId);
		return JSON.parse(raw) as SnapshotManifest;
	}
}