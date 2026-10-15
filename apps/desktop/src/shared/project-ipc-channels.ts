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
  importSprite: "assets:import-sprite",
  pickSound: "assets:pick-sound",
  pickRiggedModel: "assets:pick-rigged-model",
  confirmSmoothSkinning: "assets:confirm-smooth-skinning"
} as const;

export const CONVERTER_IPC_CHANNELS = {
  pngToNsbtx: "converter:png-to-nsbtx",
  objToNsbmd: "converter:obj-to-nsbmd",
  saveBinaryFile: "converter:save-binary-file",
  nsbtxToPng: "converter:nsbtx-to-png",
  nsbmdToObj: "converter:nsbmd-to-obj",
  nsbmdToGlb: "converter:nsbmd-to-glb",
  strmToWav: "converter:strm-to-wav"
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
