import { contextBridge, ipcRenderer } from "electron";
import type { GoodStuffWindowApi } from "@goodstuff/core";

import { APP_IPC_CHANNELS, PROJECT_IPC_CHANNELS, RECENTS_IPC_CHANNELS } from "../shared/project-ipc-channels";

/**
 * Minimal, explicit API surface exposed to the renderer. Typed against
 * the shared `GoodStuffWindowApi` contract (`@goodstuff/core`) so this
 * object can never silently drift from what `env.d.ts` and
 * `@goodstuff/ui` declare `window.goodstuff` to be.
 */
const api: GoodStuffWindowApi = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  project: {
    save: (filePath, snapshot) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.save, filePath, snapshot),
    saveAs: (snapshot) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.saveAs, snapshot),
    open: (filePath) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.open, filePath),
    listDirectory: (filePath) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.listDirectory, filePath),
    exportRom: (snapshot, projectFilePath) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.exportRom, snapshot, projectFilePath),
    play: (snapshot) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.play, snapshot)
  },
  recents: {
    list: () => ipcRenderer.invoke(RECENTS_IPC_CHANNELS.list),
    remove: (path) => ipcRenderer.invoke(RECENTS_IPC_CHANNELS.remove, path),
    clear: () => ipcRenderer.invoke(RECENTS_IPC_CHANNELS.clear)
  },
  app: {
    setUnsavedChanges: (hasUnsavedChanges) => ipcRenderer.send(APP_IPC_CHANNELS.setUnsavedChanges, hasUnsavedChanges),
    onCloseRequested: (listener) => {
      const handler = (): void => listener();
      ipcRenderer.on(APP_IPC_CHANNELS.closeRequested, handler);
      return () => {
        ipcRenderer.removeListener(APP_IPC_CHANNELS.closeRequested, handler);
      };
    },
    confirmClose: () => ipcRenderer.send(APP_IPC_CHANNELS.confirmClose)
  }
};

contextBridge.exposeInMainWorld("goodstuff", api);

export type GoodStuffApi = typeof api;
