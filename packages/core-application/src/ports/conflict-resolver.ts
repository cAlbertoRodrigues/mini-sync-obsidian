import type { Conflict } from '@mini-sync/core-domain';

export type ConflictDecisionStrategy = 'keep_local' | 'keep_remote';

export interface ConflictDecision {
  path: string;
  strategy: ConflictDecisionStrategy;
}

export interface ConflictResolver {
  resolve(conflicts: Conflict[]): Promise<ConflictDecision[]>;
}
