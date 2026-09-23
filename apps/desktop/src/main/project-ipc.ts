import { dialog, ipcMain } from "electron";
import { dirname } from "node:path";
import type { ProjectListResult, ProjectOpenResult, ProjectSaveResult, ProjectSnapshot } from "@goodstuff/core";
import {
  FileSystemProjectRepository,
  JsonProjectSerializer,
  JsonSchemaProjectSnapshotValidator,
  NodeProjectFileLister,
  NodeProjectFileReader,
  NodeProjectFileWriter,
  ProjectFileNotFoundError,
  ProjectFileReadError,
  ProjectFileWriteError,
  ProjectSerializationError,
  ProjectValidationError
} from "@goodstuff/persistence";

import { PROJECT_IPC_CHANNELS } from "../shared/project-ipc-channels";

const PROJECT_FILE_FILTERS = [{ name: "Good Stuff DS Project", extensions: ["gsds"] }];

/**
 * The one place `@goodstuff/persistence`'s abstractions get composed
 * into a concrete, Node-backed repository for this app. Swapping any
 * of these four for a different implementation (a different
 * serializer, a cloud-backed reader/writer, etc.) only touches this
 * file — see packages/persistence's own design notes for why.
 */
const repository = new FileSystemProjectRepository(
  new NodeProjectFileReader(),
  new NodeProjectFileWriter(),
  new JsonProjectSerializer(),
  new JsonSchemaProjectSnapshotValidator()
);
const lister = new NodeProjectFileLister();

/**
 * Errors thrown across the IPC boundary lose their prototype chain (the
 * renderer only ever sees a generic Error), so failures are reported as
 * plain, serializable result objects instead of thrown exceptions —
 * `instanceof` here happens on the main-process side, where the real
 * error types from `@goodstuff/persistence` are still intact.
 */
function describeError(error: unknown): { message: string; issues?: string[] } {
  if (error instanceof ProjectValidationError) {
    return { message: error.message, issues: [...error.issues] };
  }
  if (
    error instanceof ProjectFileNotFoundError ||
    error instanceof ProjectFileReadError ||
    error instanceof ProjectFileWriteError ||
    error instanceof ProjectSerializationError
  ) {
    return { message: error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

async function saveToPath(filePath: string, snapshot: ProjectSnapshot): Promise<ProjectSaveResult> {
  try {
    await repository.save(filePath, snapshot);
    return { outcome: "ok", filePath };
  } catch (error) {
    return { outcome: "error", ...describeError(error) };
  }
}

async function promptSaveLocation(snapshot: ProjectSnapshot): Promise<string | undefined> {
  const result = await dialog.showSaveDialog({
    title: "Save Project",
    defaultPath: `${snapshot.name}.gsds`,
    filters: PROJECT_FILE_FILTERS
  });
  return result.canceled ? undefined : result.filePath;
}

export function registerProjectIpcHandlers(): void {
  ipcMain.handle(
    PROJECT_IPC_CHANNELS.save,
    async (_event, filePath: string | null, snapshot: ProjectSnapshot): Promise<ProjectSaveResult> => {
      const targetPath = filePath ?? (await promptSaveLocation(snapshot));
      if (!targetPath) return { outcome: "canceled" };
      return saveToPath(targetPath, snapshot);
    }
  );

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.saveAs,
    async (_event, snapshot: ProjectSnapshot): Promise<ProjectSaveResult> => {
      const targetPath = await promptSaveLocation(snapshot);
      if (!targetPath) return { outcome: "canceled" };
      return saveToPath(targetPath, snapshot);
    }
  );

  ipcMain.handle(PROJECT_IPC_CHANNELS.open, async (): Promise<ProjectOpenResult> => {
    const result = await dialog.showOpenDialog({
      title: "Open Project",
      properties: ["openFile"],
      filters: PROJECT_FILE_FILTERS
    });
    if (result.canceled || result.filePaths.length === 0) return { outcome: "canceled" };
    const [filePath] = result.filePaths;
    try {
      const snapshot = await repository.load(filePath);
      return { outcome: "ok", filePath, snapshot };
    } catch (error) {
      return { outcome: "error", ...describeError(error) };
    }
  });

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.listDirectory,
    async (_event, filePath: string): Promise<ProjectListResult> => {
      try {
        const files = await lister.list(dirname(filePath));
        return { outcome: "ok", files };
      } catch (error) {
        return { outcome: "error", message: describeError(error).message };
      }
    }
  );
}
