import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { registerAssetsIpcHandlers } from "./assets-ipc";
import { registerExportRomIpcHandler } from "./export-rom-ipc";
import { registerPlayIpcHandler, stopPlaySession } from "./play-ipc";
import { registerProjectIpcHandlers } from "./project-ipc";
import { createRecentProjectsStore, registerRecentProjectsIpcHandlers } from "./recent-projects-ipc";
import { attachUnsavedChangesGuard } from "./unsaved-changes-guard";

const isDev = !app.isPackaged;

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Good Stuff DS Game Maker",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  attachUnsavedChangesGuard(mainWindow);

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  const recentProjects = createRecentProjectsStore();
  registerProjectIpcHandlers(recentProjects);
  registerRecentProjectsIpcHandlers(recentProjects);
  registerExportRomIpcHandler();
  registerPlayIpcHandler();
  registerAssetsIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// A game started with Play closes with the editor.
app.on("before-quit", () => void stopPlaySession());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
