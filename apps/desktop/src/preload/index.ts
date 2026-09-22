import { contextBridge } from "electron";

/**
 * Minimal, explicit API surface exposed to the renderer.
 * Extend this as the designer needs to talk to the main process (file I/O, ROM export, etc.).
 */
const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
};

contextBridge.exposeInMainWorld("goodstuff", api);

export type GoodStuffApi = typeof api;
