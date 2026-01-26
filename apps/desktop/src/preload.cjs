const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("miniSync", {
  ping: () => "pong",
});
