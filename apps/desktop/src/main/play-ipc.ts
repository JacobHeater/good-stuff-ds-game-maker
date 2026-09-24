import { app, ipcMain } from "electron";
import { join } from "node:path";
import type { PlayProjectResult, ProjectSnapshot } from "@goodstuff/core";
import { compileProject, NodeBuildFileSystem, NodeEmulatorLauncher, NodeEmulatorLocator, PlaySession } from "@goodstuff/compiler";

import { PROJECT_IPC_CHANNELS } from "../shared/project-ipc-channels";
import { createRomBuilder } from "./rom-builder-factory";

let session: PlaySession | undefined;

/** Created on first use, so the app doesn't touch the temp directory until someone presses Play. */
function playSession(): PlaySession {
  session ??= new PlaySession({
    compile: (project, outputPath) => compileProject(project, outputPath, createRomBuilder()),
    locator: new NodeEmulatorLocator(),
    launcher: new NodeEmulatorLauncher(),
    fs: new NodeBuildFileSystem(),
    romDirectory: join(app.getPath("temp"), "gsds-play")
  });
  return session;
}

/** Closes the emulator started by Play, if any. Called when the app quits. */
export function stopPlaySession(): Promise<void> {
  return session?.stop() ?? Promise.resolve();
}

/**
 * "Play": build the project as the editor has it (unsaved edits included; the project file is never
 * written) and run the ROM in an installed emulator. Runs in this process, so the editor stays usable
 * while it builds; the emulator is its own window and process.
 */
export function registerPlayIpcHandler(): void {
  ipcMain.handle(PROJECT_IPC_CHANNELS.play, async (_event, snapshot: ProjectSnapshot): Promise<PlayProjectResult> => {
    const { outcome, lines } = await playSession().play(snapshot);
    return { outcome, lines };
  });
}
