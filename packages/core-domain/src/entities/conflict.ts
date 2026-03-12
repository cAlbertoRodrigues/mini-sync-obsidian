/**
 * Represents the possible types of synchronization conflicts.
 *
 * Conflicts occur when the same file is changed differently
 * between the local and remote states during synchronization.
 *
 * @remarks
 * Each conflict type represents a specific situation that the
 * sync engine must resolve using a conflict resolution strategy.
 */
export type ConflictType =
  /**
   * Both local and remote versions of the file were modified.
   */
  | 'modified_modified'

  /**
   * The file was deleted locally but modified remotely.
   */
  | 'deleted_modified'

  /**
   * The file was modified locally but deleted remotely.
   */
  | 'modified_deleted';

/**
 * Represents a file conflict detected during synchronization.
 *
 * A conflict occurs when both the local and remote states contain
 * incompatible changes that cannot be automatically reconciled
 * without applying a resolution strategy.
 *
 * @remarks
 * The synchronization engine should detect conflicts during
 * state comparison and pass them to a conflict resolution system.
 *
 * Depending on the strategy, the system may:
 * - keep the local version
 * - keep the remote version
 * - create a merged file
 * - duplicate the file with a conflict suffix
 */
export interface Conflict {

  /**
   * Path of the file involved in the conflict.
   *
   * This path should be normalized relative to the vault root.
   */
  path: string;

  /**
   * The type of conflict detected between local and remote states.
   */
  type: ConflictType;

  /**
   * Hash of the local file version, if available.
   *
   * Used to identify the exact local content involved in the conflict.
   */
  localHash?: string;

  /**
   * Hash of the remote file version, if available.
   *
   * Used to identify the remote content involved in the conflict.
   */
  remoteHash?: string;
}