import { dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import type { ExportRomResult, ProjectSnapshot } from "@goodstuff/core";
import { compileProject, describeCompileResult, hasErrors, translateScene3D } from "@goodstuff/compiler";

import { PROJECT_IPC_CHANNELS } from "../shared/project-ipc-channels";
import { createRomBuilder } from "./rom-builder-factory";

/** The dialog's starting point: `<project name>.nds` in the project file's folder, when it has one. */
function defaultRomPath(snapshot: ProjectSnapshot, projectFilePath: string | null): string {
  const fileName = `${snapshot.name}.nds`;
  return projectFilePath ? join(dirname(projectFilePath), fileName) : fileName;
}

/** Only one build at a time: they're seconds long and each takes a temp directory and a toolchain process. */
let exporting = false;

/**
 * "Export ROM...": compile the project as the editor has it (unsaved edits included; the project file
 * is never written) and write a `.nds` where the user chooses. All of it runs in this process, off the
 * renderer's thread, and failures come back as data, never as a thrown error.
 */
export function registerExportRomIpcHandler(): void {
  ipcMain.handle(
    PROJECT_IPC_CHANNELS.exportRom,
    async (_event, snapshot: ProjectSnapshot, projectFilePath: string | null): Promise<ExportRomResult> => {
      if (exporting) {
        return { outcome: "error", lines: ["An export is already running; wait for it to finish."] };
      }
      exporting = true;
      try {
        // Check the project before asking for a location, so a project that can't be built never
        // prompts for a place to put a ROM that won't exist.
        const builder = createRomBuilder();
        if (hasErrors(translateScene3D(snapshot).diagnostics)) {
          // compileProject stops on these same errors before any build, and words them for the log.
          return { outcome: "error", lines: describeCompileResult(await compileProject(snapshot, "", builder)) };
        }

        const choice = await dialog.showSaveDialog({
          title: "Export ROM",
          defaultPath: defaultRomPath(snapshot, projectFilePath),
          filters: [{ name: "Nintendo DS ROM", extensions: ["nds"] }]
        });
        if (choice.canceled || !choice.filePath) return { outcome: "canceled", lines: [] };

        const result = await compileProject(snapshot, choice.filePath, builder);
        return {
          outcome: result.ok ? "ok" : "error",
          romPath: result.ok ? result.romPath : undefined,
          lines: describeCompileResult(result)
        };
      } catch (error) {
        return { outcome: "error", lines: [`Export failed: ${error instanceof Error ? error.message : String(error)}`] };
      } finally {
        exporting = false;
      }
    }
  );
}
