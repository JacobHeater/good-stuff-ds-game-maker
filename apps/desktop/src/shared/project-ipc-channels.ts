/** IPC channel names, shared between src/main and src/preload so they can never drift apart. */
export const PROJECT_IPC_CHANNELS = {
  save: "project:save",
  saveAs: "project:save-as",
  open: "project:open",
  listDirectory: "project:list-directory",
  exportRom: "project:export-rom",
  play: "project:play"
} as const;

export const ASSETS_IPC_CHANNELS = {
  importMesh: "assets:import-mesh",
  importTexture: "assets:import-texture",
  pickSound: "assets:pick-sound"
} as const;

export const RECENTS_IPC_CHANNELS = {
  list: "recents:list",
  remove: "recents:remove",
  clear: "recents:clear"
} as const;

export const APP_IPC_CHANNELS = {
  /** renderer -> main: whether the open project has unsaved edits. */
  setUnsavedChanges: "app:set-unsaved-changes",
  /** main -> renderer: the user tried to close the window while there are unsaved edits. */
  closeRequested: "app:close-requested",
  /** renderer -> main: the user has decided; close the window for real. */
  confirmClose: "app:confirm-close"
} as const;
