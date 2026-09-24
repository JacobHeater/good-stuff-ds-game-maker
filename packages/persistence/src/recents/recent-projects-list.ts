import { MAX_RECENT_PROJECTS, type RecentProjectEntry, type RecentProjectListing } from "@goodstuff/core";

import type { PathExistenceChecker } from "../ports/path-existence-checker";
import type { PathKey } from "./recent-project-path-key";

/**
 * The recent-list rules, in one place, shared by every `RecentProjectsReader`/
 * `Writer` implementation. Keeping them here (rather than once per
 * implementation) is what guarantees the JSON-file and in-memory versions
 * order, dedupe, cap and flag entries identically — they can't drift.
 */

/** `entry` first, any earlier entry for the same project dropped, capped at `max`. */
export function withRecorded(
  entries: readonly RecentProjectEntry[],
  entry: RecentProjectEntry,
  key: PathKey,
  max: number = MAX_RECENT_PROJECTS
): RecentProjectEntry[] {
  const identity = key(entry.path);
  return [entry, ...entries.filter((existing) => key(existing.path) !== identity)].slice(0, max);
}

export function withoutPath(entries: readonly RecentProjectEntry[], path: string, key: PathKey): RecentProjectEntry[] {
  const identity = key(path);
  return entries.filter((existing) => key(existing.path) !== identity);
}

/** Flags each entry `missing` if its file is gone. A checker that throws counts as missing. */
export async function withMissingFlags(
  entries: readonly RecentProjectEntry[],
  checker: PathExistenceChecker
): Promise<RecentProjectListing[]> {
  return Promise.all(
    entries.map(async (entry) => {
      let present = false;
      try {
        present = await checker.exists(entry.path);
      } catch {
        present = false;
      }
      return { ...entry, missing: !present };
    })
  );
}
