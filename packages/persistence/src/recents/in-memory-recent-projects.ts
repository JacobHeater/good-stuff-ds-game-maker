import type { RecentProjectEntry, RecentProjectListing } from "@goodstuff/core";

import type { PathExistenceChecker } from "../ports/path-existence-checker";
import type { RecentProjectsReader } from "../ports/recent-projects-reader";
import type { RecentProjectsWriter } from "../ports/recent-projects-writer";
import { createPathKey, type PathKey } from "./recent-project-path-key";
import { withMissingFlags, withRecorded, withoutPath } from "./recent-projects-list";

export interface InMemoryRecentProjectsOptions {
  pathKey?: PathKey;
  /** Decides which entries are flagged `missing`. Defaults to treating every file as present. */
  existence?: PathExistenceChecker;
}

/**
 * In-memory recent projects, for tests and previews. Implements the same two
 * ports as `JsonFileRecentProjectsStore` and shares its list rules, so given
 * the same existence checker it behaves identically (Liskov substitutable).
 */
export class InMemoryRecentProjects implements RecentProjectsReader, RecentProjectsWriter {
  private entries: RecentProjectEntry[] = [];
  private readonly pathKey: PathKey;
  private readonly existence: PathExistenceChecker;

  constructor(options: InMemoryRecentProjectsOptions = {}) {
    this.pathKey = options.pathKey ?? createPathKey();
    this.existence = options.existence ?? { exists: async () => true };
  }

  async list(): Promise<RecentProjectListing[]> {
    return withMissingFlags(this.entries, this.existence);
  }

  async record(entry: RecentProjectEntry): Promise<void> {
    this.entries = withRecorded(this.entries, entry, this.pathKey);
  }

  async remove(path: string): Promise<void> {
    this.entries = withoutPath(this.entries, path, this.pathKey);
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
