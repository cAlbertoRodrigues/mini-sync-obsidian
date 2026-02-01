import { app, BrowserWindow, Menu } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const width = 813;
  const height = 654;

  const win = new BrowserWindow({
    width,
    height,

    resizable: false,
    maximizable: false,
    fullscreenable: false,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });

  win.setMinimumSize(width, height);
  win.setMaximumSize(width, height);

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
