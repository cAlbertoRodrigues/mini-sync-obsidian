import type { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";

import type { SyncProvider, SyncCursor } from "../ports/sync-provider";
import type { HistoryEvent } from "../value-objects/history-event";

import { createDriveClient } from "./google-drive-client";
import {
  ensureVaultFolder,
  ensureHistoryFolder,
  ensureDailyHistoryFile,
  ensureCursorFile,
  downloadText,
  uploadText,
  appendJsonl,
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
 */
export class GoogleDriveSyncProvider implements SyncProvider {
  private readonly drive: drive_v3.Drive;

  constructor(
    private readonly auth: OAuth2Client,
    private readonly vaultId: string
  ) {
    this.drive = createDriveClient(auth);
  }

  public async setRemoteCursor(cursor: SyncCursor | null): Promise<void> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    await this.writeRemoteCursor(vaultFolderId, cursor);
  }

  /* ------------------------------------------------------------------ */
  /* Cursor helpers                                                      */
  /* ------------------------------------------------------------------ */

  private async readRemoteCursor(vaultFolderId: string): Promise<SyncCursor | null> {
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

  /* ------------------------------------------------------------------ */
  /* Pull incremental (Drive → Local)                                    */
  /* ------------------------------------------------------------------ */

  async pullHistoryEvents(
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

    const last = events[events.length - 1];
    const nextCursor: SyncCursor = { value: last.occurredAtIso };

    return { events, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /* Pull completo (usado para dedupe / conflitos)                       */
  /* ------------------------------------------------------------------ */

  async pullAllHistoryEvents(): Promise<HistoryEvent[]> {
    const vaultFolderId = await ensureVaultFolder(this.auth, this.vaultId);
    const historyFolderId = await ensureHistoryFolder(this.auth, vaultFolderId);

    const events: HistoryEvent[] = [];
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
        if (!f.id) continue;

        const content = await downloadText(this.auth, f.id);
        const lines = content.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            events.push(JSON.parse(line) as HistoryEvent);
          } catch {
            // ignore
          }
        }
      }

      pageToken = res.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  /* ------------------------------------------------------------------ */
  /* Push incremental (Local → Drive)                                    */
  /* ------------------------------------------------------------------ */

  async pushHistoryEvents(events: HistoryEvent[]): Promise<void> {
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

    // atualiza cursor remoto com o último evento enviado
    const last = events[events.length - 1];
    await this.writeRemoteCursor(vaultFolderId, {
      value: last.occurredAtIso,
    });
  }
}
