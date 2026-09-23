/**
 * Lists file paths under a directory. Segregated from reading and
 * writing — a read-only browsing surface (e.g. the `file-browser`
 * component's eventual real implementation) needs exactly this, not
 * write access to files it's only meant to display.
 */
export interface ProjectFileLister {
  /** Throws ProjectFileNotFoundError if `directoryPath` does not exist, ProjectFileReadError for any other failure. */
  list(directoryPath: string): Promise<string[]>;
}
