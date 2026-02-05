export type ChangeRow = {
  path: string;
  status: "synced" | "local_changed" | "remote_changed" | "conflict";
  summary: string;
  conflictType: string | null;
  isConflict: boolean;
  conflictsCount: number;
};

export type ConflictStrategyUi = "keep_local" | "keep_remote" | "manual_merge";
