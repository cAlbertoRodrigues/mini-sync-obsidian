import type { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";

import type { HistoryEvent } from "../value-objects/history-event";
import type { SnapshotManifest } from "../value-objects/snapshot-manifest";
import type {
  BlobKey,
  SnapshotKey,
  SyncCursor,
  SyncProvider,
} from "../ports/sync-provider";

import { createDriveClient } from "./google-drive-client";
import {
  ensureVaultFolder,
  ensureHistoryFolder,
  ensureDailyHistoryFile,
  ensureCursorFile,
  ensureSnapshotsFolder,
  downloadText,
  uploadText,
  appendJsonl,
  ensureFolder,
} from "./google-drive-files";

/**
 * SyncProvider baseado em Google Drive.
 *
 * Estrutura no Drive:
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
 */
export class GoogleDriveSyncProvider implements SyncProvider {
  private readonly drive: drive_v3.Drive;

  private static readonly BLOBS_FOLDER_NAME = "blobs";

  constructor(
    private readonly auth: OAuth2Client,
    private readonly vaultId: string
  ) {
    this.drive = createDriveClient(auth);
  }

  // ------------------------------------------------------------------
  // Cursor (extra — não faz parte da interface, mas é útil)
  // ------------------------------------------------------------------

  public async setRemoteCursor(cursor: SyncCursor | null): Promise<void> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    await this.writeRemoteCursor(vaultFolderId, cursor);
  }

  private async readRemoteCursor(
    vaultFolderId: string
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

  private async writeRemoteCursor(
    vaultFolderId: string,
    cursor: SyncCursor | null
  ): Promise<void> {
    const cursorFileId = await ensureCursorFile(this.auth, vaultFolderId);

    await uploadText(
      this.auth,
      cursorFileId,
      JSON.stringify({ value: cursor?.value ?? null }, null, 2),
      "application/json"
    );
  }

  // ------------------------------------------------------------------
  // History (interface)
  // ------------------------------------------------------------------

  public async pullHistoryEvents(
    cursor: SyncCursor | null
  ): Promise<{ events: HistoryEvent[]; nextCursor: SyncCursor | null }> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const historyFolderId = await ensureHistoryFolder(this.auth, vaultFolderId);

    const baseIso = cursor?.value ?? null;
    const events: HistoryEvent[] = [];

    // Lista arquivos YYYY-MM-DD.jsonl
    let pageToken: string | undefined = undefined;

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
        (f) => f.name && f.name.endsWith(".jsonl")
      );

      for (const f of files) {
        if (!f.id || !f.name) continue;

        const content = await downloadText(this.auth, f.id);
        const lines = content.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const ev = JSON.parse(line) as HistoryEvent;
            if (!baseIso || ev.occurredAtIso > baseIso) {
              events.push(ev);
            }
          } catch {
            // tolera linha inválida
          }
        }
      }

      pageToken = res.nextPageToken ?? undefined;
    } while (pageToken);

    if (events.length === 0) {
      return { events: [], nextCursor: cursor };
    }

    // garante ordem por data (caso Drive retorne fora)
    events.sort((a, b) => (a.occurredAtIso < b.occurredAtIso ? -1 : 1));

    const last = events[events.length - 1];
    const nextCursor: SyncCursor = { value: last.occurredAtIso };
    return { events, nextCursor };
  }

  public async pushHistoryEvents(events: HistoryEvent[]): Promise<void> {
    if (events.length === 0) return;

    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const historyFolderId = await ensureHistoryFolder(this.auth, vaultFolderId);

    const byDay = new Map<string, HistoryEvent[]>();
    for (const ev of events) {
      const day = ev.occurredAtIso.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(ev);
      byDay.set(day, list);
    }

    for (const [day, list] of byDay.entries()) {
      const fileId = await ensureDailyHistoryFile(
        this.auth,
        historyFolderId,
        day
      );

      const lines = list.map((e) => JSON.stringify(e));
      await appendJsonl(this.auth, fileId, lines);
    }

    // Atualiza cursor remoto com o último evento enviado
    const last = events[events.length - 1];
    await this.writeRemoteCursor(vaultFolderId, { value: last.occurredAtIso });
  }

  // ------------------------------------------------------------------
  // Blobs (interface)
  // ------------------------------------------------------------------

  private async ensureBlobsFolder(vaultFolderId: string): Promise<string> {
    return ensureFolder(
      this.auth,
      vaultFolderId,
      GoogleDriveSyncProvider.BLOBS_FOLDER_NAME
    );
  }

  private escapeQueryValue(v: string): string {
    // Drive query usa aspas simples; precisa escapar '
    return v.replace(/'/g, "\\'");
  }

  private async findChildFileIdByName(
    parentId: string,
    name: string
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

  private async downloadBytes(fileId: string): Promise<Buffer> {
    // Tipagem mais permissiva pra suportar responseType no node
    const files = this.drive.files as unknown as {
      get: (
        params: { fileId: string; alt?: "media" },
        options?: { responseType?: "arraybuffer" }
      ) => Promise<{ data: ArrayBuffer }>;
    };

    const res = await files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    return Buffer.from(new Uint8Array(res.data));
  }

  private async uploadBytes(
    fileId: string,
    data: Buffer,
    mimeType = "application/octet-stream"
  ): Promise<void> {
    await this.drive.files.update({
      fileId,
      media: { mimeType, body: data as unknown as any },
    });
  }

  public async hasBlob(key: BlobKey): Promise<boolean> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

    const fileId = await this.findChildFileIdByName(blobsFolderId, key.sha256);
    return !!fileId;
  }

  public async putBlob(key: BlobKey, data: Buffer): Promise<void> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

    const existingId = await this.findChildFileIdByName(
      blobsFolderId,
      key.sha256
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
        body: data as unknown as any,
      },
      fields: "id",
    });

    if (!created.data.id) {
      throw new Error("Falha ao criar blob no Google Drive");
    }
  }

  public async getBlob(key: BlobKey): Promise<Buffer> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const blobsFolderId = await this.ensureBlobsFolder(vaultFolderId);

    const fileId = await this.findChildFileIdByName(blobsFolderId, key.sha256);
    if (!fileId) {
      throw new Error(`Blob não encontrado no Drive: ${key.sha256}`);
    }

    return this.downloadBytes(fileId);
  }

  // ------------------------------------------------------------------
  // Snapshots (interface)
  // ------------------------------------------------------------------

  public async listSnapshots(): Promise<SnapshotKey[]> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const snapshotsFolderId = await ensureSnapshotsFolder(
      this.auth,
      vaultFolderId
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
    for (const f of res.data.files ?? []) {
      if (!f.name) continue;
      if (!f.name.endsWith(".json")) continue;

      const id = f.name.slice(0, -".json".length);
      if (id) keys.push({ id });
    }

    // ordena por id (o provider decide a ordenação)
    keys.sort((a, b) => (a.id < b.id ? -1 : 1));
    return keys;
  }

  public async putSnapshotManifest(
    key: SnapshotKey,
    manifest: SnapshotManifest
  ): Promise<void> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const snapshotsFolderId = await ensureSnapshotsFolder(
      this.auth,
      vaultFolderId
    );

    const name = `${key.id}.json`;
    const existingId = await this.findChildFileIdByName(snapshotsFolderId, name);

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

  public async getSnapshotManifest(key: SnapshotKey): Promise<SnapshotManifest> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const snapshotsFolderId = await ensureSnapshotsFolder(
      this.auth,
      vaultFolderId
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