/**
 * Writes raw file contents. Segregated from reading and listing — see
 * `ProjectFileReader`. A "Save" action needs exactly this capability,
 * nothing more.
 */
export interface ProjectFileWriter {
  /** Throws ProjectFileWriteError on failure. Creates parent directories as needed. */
  write(path: string, contents: string): Promise<void>;
}
