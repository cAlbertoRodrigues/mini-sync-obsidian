import type { FileRecord } from './file-record';

/**
 * Represents the result of comparing two file states (e.g., local vs remote).
 *
 * A ChangeSet groups all detected differences into three categories:
 * - files that were added
 * - files that were modified
 * - files that were deleted
 *
 * This structure is typically produced by a state comparison service
 * and then consumed by the synchronization engine to determine which
 * actions must be performed (upload, download, or delete).
 *
 * @remarks
 * A ChangeSet should contain each file path in only one category.
 * The synchronization logic should treat these lists as the
 * authoritative description of changes between states.
 */
export interface ChangeSet {

  /**
   * Files that exist in the current state but did not exist in the previous state.
   *
   * These represent newly created files and may require uploading
   * to the remote provider or downloading to the local vault,
   * depending on the synchronization direction.
   */
  added: FileRecord[];

  /**
   * Files that existed previously but whose content or metadata changed.
   *
   * A modification is typically detected using hash comparison,
   * file size differences, timestamps, or a combination of these.
   */
  modified: FileRecord[];

  /**
   * Files that existed previously but are no longer present in the current state.
   *
   * Only the path is required to represent the deletion, but the previous
   * hash may be included to help detect conflicts or validate the removal.
   */
  deleted: {
    /**
     * Path of the file that was removed.
     */
    path: string;

    /**
     * Hash of the file before deletion, if known.
     * This can be used for validation or conflict detection.
     */
    previousHash?: string;
  }[];
}