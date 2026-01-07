export type ConflictResolutionStrategy = "local" | "remote";

export type ConflictDecision = {
  path: string;
  strategy: ConflictResolutionStrategy;
  decidedAtIso: string;
};

export interface ConflictDecisionStore {
  get(vaultRootAbs: string, path: string): Promise<ConflictDecision | null>;
  set(vaultRootAbs: string, decision: ConflictDecision): Promise<void>;
  remove(vaultRootAbs: string, path: string): Promise<void>;
  list(vaultRootAbs: string): Promise<ConflictDecision[]>;
}
