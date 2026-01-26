import { app, BrowserWindow, Menu } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 813,
    height: 654,
    backgroundColor: "#1e1e1e",
    frame: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "../src/preload.cjs"),
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "src/index.html"));
  win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
