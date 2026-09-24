import type { RecentProjectListing } from "@goodstuff/core";

/**
 * Reads the remembered projects. Segregated from `RecentProjectsWriter`: a
 * consumer that only displays the list (the startup view, the Project menu)
 * gets no way to change it.
 */
export interface RecentProjectsReader {
  /**
   * Most recently opened first. Never throws for a missing, unreadable or
   * invalid backing store — that is simply an empty list. Entries whose file
   * no longer exists are still returned, flagged `missing`.
   */
  list(): Promise<RecentProjectListing[]>;
}
