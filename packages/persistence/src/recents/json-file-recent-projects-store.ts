import type { RecentProjectEntry, RecentProjectListing } from "@goodstuff/core";
import Ajv, { type ValidateFunction } from "ajv";

import type { PathExistenceChecker } from "../ports/path-existence-checker";
import type { ProjectFileReader } from "../ports/project-file-reader";
import type { ProjectFileWriter } from "../ports/project-file-writer";
import type { RecentProjectsReader } from "../ports/recent-projects-reader";
import type { RecentProjectsWriter } from "../ports/recent-projects-writer";
import { createPathKey, type PathKey } from "./recent-project-path-key";
import { withMissingFlags, withRecorded, withoutPath } from "./recent-projects-list";
import { RECENT_PROJECTS_FORMAT_VERSION, RECENT_PROJECTS_JSON_SCHEMA } from "./recent-projects.schema";

export interface JsonFileRecentProjectsStoreOptions {
  /** Defaults to the platform's path identity (case-insensitive on Windows). */
  pathKey?: PathKey;
  /** Used to flag missing project files. Defaults to `fileReader`, which satisfies it. */
  existence?: PathExistenceChecker;
}

/**
 * Recent projects persisted as schema-validated JSON in a single file.
 *
 * Built from the same file ports as project persistence (`ProjectFileReader`
 * to read the store, `ProjectFileWriter` to write it), so pointing it at
 * `InMemoryProjectFileStore` gives a fully in-memory store with identical
 * behavior. It is one class implementing both `RecentProjectsReader` and
 * `RecentProjectsWriter`, but callers should be handed only the port they need.
 *
 * Reads never fail: a store that's absent, unreadable, not JSON, or fails the
 * schema is an empty list, replaced on the next write. Operations are run one
 * at a time, so overlapping record/remove/list calls can't interleave a read
 * with a half-finished write.
 */
export class JsonFileRecentProjectsStore implements RecentProjectsReader, RecentProjectsWriter {
  private readonly validate: ValidateFunction;
  private readonly pathKey: PathKey;
  private readonly existence: PathExistenceChecker;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fileReader: ProjectFileReader,
    private readonly fileWriter: ProjectFileWriter,
    private readonly storePath: string,
    options: JsonFileRecentProjectsStoreOptions = {}
  ) {
    this.validate = new Ajv({ allErrors: true }).compile(RECENT_PROJECTS_JSON_SCHEMA);
    this.pathKey = options.pathKey ?? createPathKey();
    this.existence = options.existence ?? fileReader;
  }

  list(): Promise<RecentProjectListing[]> {
    return this.serialized(async () => withMissingFlags(await this.readStored(), this.existence));
  }

  record(entry: RecentProjectEntry): Promise<void> {
    return this.serialized(async () => this.writeStored(withRecorded(await this.readStored(), entry, this.pathKey)));
  }

  remove(path: string): Promise<void> {
    return this.serialized(async () => this.writeStored(withoutPath(await this.readStored(), path, this.pathKey)));
  }

  clear(): Promise<void> {
    return this.serialized(() => this.writeStored([]));
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readStored(): Promise<RecentProjectEntry[]> {
    try {
      const parsed: unknown = JSON.parse(await this.fileReader.read(this.storePath));
      if (!this.validate(parsed)) return [];
      return (parsed as { projects: RecentProjectEntry[] }).projects;
    } catch {
      return [];
    }
  }

  private writeStored(projects: RecentProjectEntry[]): Promise<void> {
    const contents = JSON.stringify({ formatVersion: RECENT_PROJECTS_FORMAT_VERSION, projects }, null, 2);
    return this.fileWriter.write(this.storePath, contents);
  }
}
