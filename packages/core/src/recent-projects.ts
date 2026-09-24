import type { ProjectMode } from "./project-mode";

/**
 * One remembered project, as recorded by the Electron main process whenever a
 * project is opened or saved to a new location (see
 * requirements/project-list/SPIKE.recent-projects-storage.md). `name` and
 * `mode` are copied in at record time so listing never has to open the project
 * file; that's safe because a project's mode is permanent and there's no
 * rename feature.
 */
export interface RecentProjectEntry {
  path: string;
  name: string;
  mode: ProjectMode;
  /** ISO 8601 timestamp. */
  lastOpenedAt: string;
}

/**
 * A recent project as shown to the UI: the stored entry plus whether its file
 * still exists right now. Existence is checked when the list is read, never
 * stored, and a missing entry is kept (flagged) rather than pruned.
 */
export interface RecentProjectListing extends RecentProjectEntry {
  missing: boolean;
}

/** The recent list never holds more than this many projects; the oldest is dropped. */
export const MAX_RECENT_PROJECTS = 10;
