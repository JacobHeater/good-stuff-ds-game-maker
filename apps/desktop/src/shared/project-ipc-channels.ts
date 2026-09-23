/** IPC channel names, shared between src/main and src/preload so they can never drift apart. */
export const PROJECT_IPC_CHANNELS = {
  save: "project:save",
  saveAs: "project:save-as",
  open: "project:open",
  listDirectory: "project:list-directory"
} as const;
