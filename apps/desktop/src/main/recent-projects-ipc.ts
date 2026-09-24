import { app, ipcMain } from "electron";
import { join } from "node:path";
import type { ProjectSnapshot, RecentProjectListing } from "@goodstuff/core";
import {
  JsonFileRecentProjectsStore,
  NodeProjectFileReader,
  NodeProjectFileWriter,
  type RecentProjectsReader,
  type RecentProjectsWriter
} from "@goodstuff/persistence";

import { RECENTS_IPC_CHANNELS } from "../shared/project-ipc-channels";

/**
 * Where recent projects are remembered: one JSON file in the per-user app-data
 * directory, only ever touched from this (main) process — see
 * requirements/project-list/SPIKE.recent-projects-storage.md. Pass
 * `--user-data-dir` to Electron to point it somewhere else (tests do).
 *
 * The one concrete store is exposed as two segregated ports so each consumer
 * gets only what it needs: the project handlers record, the recents handlers
 * list and prune.
 */
export function createRecentProjectsStore(): RecentProjectsReader & RecentProjectsWriter {
  return new JsonFileRecentProjectsStore(
    new NodeProjectFileReader(),
    new NodeProjectFileWriter(),
    join(app.getPath("userData"), "recent-projects.json")
  );
}

/**
 * Remembers that `snapshot`'s project lives at `filePath`. Best-effort: the
 * user's open or save already succeeded, so a failure to update the recent
 * list is logged, never surfaced.
 */
export async function recordRecentProject(
  recents: RecentProjectsWriter,
  filePath: string,
  snapshot: ProjectSnapshot
): Promise<void> {
  try {
    await recents.record({
      path: filePath,
      name: snapshot.name,
      mode: snapshot.mode,
      lastOpenedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Could not update the recent projects list:", error);
  }
}

/** Registers list/remove/clear. There is deliberately no "record" channel: only this process records. */
export function registerRecentProjectsIpcHandlers(recents: RecentProjectsReader & RecentProjectsWriter): void {
  ipcMain.handle(RECENTS_IPC_CHANNELS.list, (): Promise<RecentProjectListing[]> => recents.list());

  ipcMain.handle(RECENTS_IPC_CHANNELS.remove, async (_event, path: string): Promise<RecentProjectListing[]> => {
    try {
      await recents.remove(path);
    } catch (error) {
      console.warn("Could not update the recent projects list:", error);
    }
    return recents.list();
  });

  ipcMain.handle(RECENTS_IPC_CHANNELS.clear, async (): Promise<RecentProjectListing[]> => {
    try {
      await recents.clear();
    } catch (error) {
      console.warn("Could not update the recent projects list:", error);
    }
    return recents.list();
  });
}
