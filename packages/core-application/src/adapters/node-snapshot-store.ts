import fs from "fs/promises";
import path from "path";

import type { SnapshotStore } from "../ports/snapshot-store";
import type { SnapshotId } from "@mini-sync/core-domain";
import type { DeviceId, VaultId } from "@mini-sync/core-domain";
import type { Snapshot } from "@mini-sync/core-domain";

/**
 * Node implementation of the SnapshotStore port.  Snapshots are stored
 * under a `.mini-sync/snapshots` directory inside the vault root.  A separate
 * state file maintains the last synced snapshot ID per device.
 */
export class NodeSnapshotStore implements SnapshotStore {
  /** Build the directory path where snapshots are stored for a given vault. */
  private snapshotsDir(vaultRoot: string): string {
    return path.join(vaultRoot, ".mini-sync", "snapshots");
  }

  /** Path to the last synced snapshot registry for a device per vault. */
  private lastSyncedFile(vaultRoot: string): string {
    return path.join(vaultRoot, ".mini-sync", "state", "last-synced.json");
  }

  /**
   * Resolve the absolute directory from the given vaultId.  The API expects
   * the vaultId to be a VaultId string, but in this adapter we interpret it
   * as the path to the vault on disk.
   */
  private resolveVaultRoot(vaultId: VaultId): string {
    return path.resolve(String(vaultId));
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const vaultRoot = this.resolveVaultRoot(snapshot.vaultId);
    const dir = this.snapshotsDir(vaultRoot);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${snapshot.id}.json`);
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  async getLastSyncedSnapshotId(vaultId: VaultId, deviceId: DeviceId): Promise<SnapshotId | null> {
    const vaultRoot = this.resolveVaultRoot(vaultId);
    const file = this.lastSyncedFile(vaultRoot);
    try {
      const content = await fs.readFile(file, "utf-8");
      const data = JSON.parse(content) as Record<DeviceId, SnapshotId>;
      const val = data[String(deviceId) as any];
      return val ?? null;
    } catch {
      return null;
    }
  }

  async markAsLastSynced(vaultId: VaultId, deviceId: DeviceId, snapshotId: SnapshotId): Promise<void> {
    const vaultRoot = this.resolveVaultRoot(vaultId);
    const file = this.lastSyncedFile(vaultRoot);
    let data: Record<DeviceId, SnapshotId> = {};
    try {
      const content = await fs.readFile(file, "utf-8");
      data = JSON.parse(content) as Record<DeviceId, SnapshotId>;
    } catch {
      // file missing, start new registry
      data = {};
    }
    data[String(deviceId) as any] = snapshotId;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  }
}