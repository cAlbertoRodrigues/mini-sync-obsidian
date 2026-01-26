import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("miniSync", {
  ping: () => ipcRenderer.send("ping"),
});
