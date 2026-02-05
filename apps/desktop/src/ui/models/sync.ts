export type SyncUiStatus = "idle" | "syncing" | "ok" | "conflict" | "error";

export type SyncStatusPayload =
  | {
      vaultId: string;
      status: "syncing";
      atIso: string;
    }
  | {
      vaultId: string;
      status: "ok" | "conflict";
      atIso: string;
      summary?: any;
    }
  | {
      vaultId: string;
      status: "error";
      atIso: string;
      error: string;
    };
