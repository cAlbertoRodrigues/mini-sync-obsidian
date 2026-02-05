import { contextBridge, ipcRenderer } from "electron";

type IpcChannel =
  | "changes:list"
  | "changes:readFileSide"
  | "changes:saveMerged"
  | "changes:acceptResolution"
  | "sync:run"
  | "sync:status";

type Unsubscribe = () => void;

const api = {
  invoke<T = unknown>(channel: Exclude<IpcChannel, "sync:status">, args?: any) {
    return ipcRenderer.invoke(channel, args) as Promise<T>;
  },

  on<T = unknown>(channel: Extract<IpcChannel, "sync:status">, listener: (payload: T) => void): Unsubscribe {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type DesktopApi = typeof api;
