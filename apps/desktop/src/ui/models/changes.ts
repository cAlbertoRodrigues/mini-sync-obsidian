export type ChangeStatus =
  | "synced"
  | "local_changed"
  | "remote_changed"
  | "both_changed"
  | "conflict";

export type ChangeItem = {
  path: string;
  status: ChangeStatus;
  summary?: string;
};
