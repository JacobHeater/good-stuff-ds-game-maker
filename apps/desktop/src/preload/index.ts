import { contextBridge, ipcRenderer } from "electron";
import type { GoodStuffWindowApi } from "@goodstuff/core";

import { PROJECT_IPC_CHANNELS } from "../shared/project-ipc-channels";

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
    open: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.open),
    listDirectory: (filePath) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.listDirectory, filePath)
  }
};

contextBridge.exposeInMainWorld("goodstuff", api);

export type GoodStuffApi = typeof api;
