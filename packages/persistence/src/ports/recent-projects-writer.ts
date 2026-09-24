import type { RecentProjectEntry } from "@goodstuff/core";

/**
 * Changes the remembered projects. Segregated from `RecentProjectsReader`.
 * Throws `ProjectFileWriteError` if the backing store can't be written.
 */
export interface RecentProjectsWriter {
  /**
   * Adds `entry` at the top. A project already present (same resolved path)
   * is moved to the top rather than duplicated, and the list is capped at
   * `MAX_RECENT_PROJECTS`, dropping the oldest.
   */
  record(entry: RecentProjectEntry): Promise<void>;
  /** Forgets one project by path. Unknown paths are a no-op. The project file itself is never touched. */
  remove(path: string): Promise<void>;
  clear(): Promise<void>;
}
