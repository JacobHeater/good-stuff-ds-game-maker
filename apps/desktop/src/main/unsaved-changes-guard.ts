import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";

import { APP_IPC_CHANNELS } from "../shared/project-ipc-channels";

/**
 * Holds a window's close while its project has unsaved edits.
 *
 * The renderer owns the truth about what's unsaved (it holds the scene) and
 * pushes a boolean here on every change. When the user tries to close the
 * window and that boolean is set, the close is cancelled and the renderer is
 * asked to run its Save / Don't Save / Cancel prompt; if the user chooses to
 * go ahead it calls back with `confirmClose`, which closes for real. Doing it
 * this way keeps a single prompt implementation (in the renderer) for every
 * "this would discard edits" path — Close Project, Open Project and closing
 * the window. See requirements/project-menu/STORY.unsaved-changes-guard.md.
 */
export function attachUnsavedChangesGuard(window: BrowserWindow): void {
  let hasUnsavedChanges = false;
  let closeConfirmed = false;

  const fromThisWindow = (event: IpcMainEvent): boolean => event.sender === window.webContents;

  const onSetUnsavedChanges = (event: IpcMainEvent, value: unknown): void => {
    if (fromThisWindow(event)) hasUnsavedChanges = value === true;
  };
  const onConfirmClose = (event: IpcMainEvent): void => {
    if (!fromThisWindow(event)) return;
    closeConfirmed = true;
    window.close();
  };

  ipcMain.on(APP_IPC_CHANNELS.setUnsavedChanges, onSetUnsavedChanges);
  ipcMain.on(APP_IPC_CHANNELS.confirmClose, onConfirmClose);

  window.on("close", (event) => {
    if (!hasUnsavedChanges || closeConfirmed || window.webContents.isDestroyed()) return;
    event.preventDefault();
    window.webContents.send(APP_IPC_CHANNELS.closeRequested);
  });

  window.on("closed", () => {
    ipcMain.removeListener(APP_IPC_CHANNELS.setUnsavedChanges, onSetUnsavedChanges);
    ipcMain.removeListener(APP_IPC_CHANNELS.confirmClose, onConfirmClose);
  });
}
