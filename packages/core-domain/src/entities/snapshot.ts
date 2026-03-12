import type { VaultId } from '../value-objects/ids';
import type { FileRecord } from './file-record';

/**
 * Unique identifier for a snapshot.
 *
 * A SnapshotId distinguishes one recorded vault state from another.
 * It may be generated using a UUID, timestamp-based identifier,
 * or another unique ID strategy.
 */
export type SnapshotId = string;

/**
 * Represents a captured state of a vault at a specific moment in time.
 *
 * A Snapshot contains the list of all tracked files and their metadata
 * when the snapshot was created. It is commonly used to compare
 * different states of the vault in order to detect changes and
 * generate synchronization operations.
 *
 * @remarks
 * Snapshots are essential for incremental synchronization because they
 * allow the system to compare:
 *
 * - the current vault state
 * - the previously known state
 *
 * This comparison produces a {@link ChangeSet} describing the
 * differences between the two states.
 *
 * @see FileRecord
 */
export interface Snapshot {

  /**
   * Unique identifier of the snapshot.
   */
  id: SnapshotId;

  /**
   * Identifier of the vault that this snapshot belongs to.
   *
   * This allows the synchronization system to track snapshots
   * for multiple vaults independently.
   */
  vaultId: VaultId;

  /**
   * Timestamp representing when the snapshot was created.
   *
   * The value is expressed in milliseconds since the Unix epoch.
   */
  createdAtMs: number;

  /**
   * List of files recorded in this snapshot.
   *
   * Each entry represents the metadata of a file at the time
   * the snapshot was captured.
   */
  files: FileRecord[];
}