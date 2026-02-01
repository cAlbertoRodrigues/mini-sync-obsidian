import { contextBridge, ipcRenderer } from "electron";
import type { ChangeItem } from "./ui/models/changes.js";

contextBridge.exposeInMainWorld("miniSync", {
  listChanges(vaultId: string): Promise<ChangeItem[]> {
    return ipcRenderer.invoke("changes:list", { vaultId });
  },

  readFileSide(
    vaultId: string,
    filePath: string,
    side: "base" | "local" | "remote"
  ): Promise<string> {
    return ipcRenderer.invoke("changes:readFileSide", { vaultId, filePath, side });
  },

  saveMerged(vaultId: string, filePath: string, content: string): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke("changes:saveMerged", { vaultId, filePath, content });
  },

  acceptResolution(
    vaultId: string,
    filePath: string,
    strategy: "keep_local" | "keep_remote" | "manual_merge"
  ): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke("changes:acceptResolution", { vaultId, filePath, strategy });
  },
});
