import type { FileRecord } from './file-record';
export interface ChangeSet {
    added: FileRecord[];
    modified: FileRecord[];
    deleted: {
        path: string;
        previousHash?: string;
    }[];
}
