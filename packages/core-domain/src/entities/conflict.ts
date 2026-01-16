export type ConflictType = 'modified_modified' | 'deleted_modified' | 'modified_deleted';

export interface Conflict {
  path: string;
  type: ConflictType;

  localHash?: string;
  remoteHash?: string;
}
