/**
 * Reads raw file contents. Deliberately segregated from writing and
 * directory listing — a consumer that only ever opens a project (e.g.
 * `startup-view`'s Open Existing Project flow) should depend on exactly
 * this and nothing more; it has no business being handed write or
 * listing capability it will never call.
 */
export interface ProjectFileReader {
  /** Throws ProjectFileNotFoundError if `path` does not exist, ProjectFileReadError for any other read failure. */
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}
