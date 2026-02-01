const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miniSync", {
  listChanges: (vaultId) => ipcRenderer.invoke("changes:list", { vaultId }),
  readFileSide: (vaultId, filePath, side) =>
    ipcRenderer.invoke("changes:readFileSide", { vaultId, filePath, side }),
  saveMerged: (vaultId, filePath, content) =>
    ipcRenderer.invoke("changes:saveMerged", { vaultId, filePath, content }),
  acceptResolution: (vaultId, filePath, strategy) =>
    ipcRenderer.invoke("changes:acceptResolution", { vaultId, filePath, strategy }),
});
