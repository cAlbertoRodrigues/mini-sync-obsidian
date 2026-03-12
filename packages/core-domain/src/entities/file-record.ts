/**
 * Represents the hash of a file's content.
 *
 * The hash is used to detect changes between file versions during
 * synchronization. Two files with the same hash are assumed to have
 * identical content.
 *
 * @remarks
 * The hashing algorithm may vary depending on the implementation
 * (e.g., SHA-1, SHA-256, MD5). The sync engine only relies on the
 * hash value for comparison purposes.
 */
export type FileHash = string;

/**
 * Represents the metadata of a file tracked by the synchronization system.
 *
 * A FileRecord describes the essential properties required to detect
 * changes between different file states (local vs remote).
 *
 * @remarks
 * FileRecord instances are commonly used when:
 * - scanning the vault
 * - comparing states between sync cycles
 * - generating ChangeSets
 * - validating conflicts
 */
export interface FileRecord {

  /**
   * Path of the file relative to the vault root.
   *
   * Paths should be normalized to ensure consistent comparison
   * across operating systems.
   */
  path: string;

  /**
   * Content hash of the file.
   *
   * Used to detect modifications between file versions.
   */
  hash: FileHash;

  /**
   * Size of the file in bytes.
   *
   * Although the hash is the primary change detector,
   * the file size can be used as a quick validation step.
   */
  size: number;

  /**
   * Last modification time of the file in milliseconds.
   *
   * This value typically comes from the filesystem metadata
   * and may be used as an additional signal for change detection.
   */
  mtimeMs: number;
}