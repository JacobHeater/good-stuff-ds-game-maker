import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { ProjectFileNotFoundError, ProjectFileReadError } from "../errors";
import type { ProjectFileLister } from "../ports/project-file-lister";
import { isErrnoException } from "./node-errno";

/** Node `fs/promises`-backed ProjectFileLister, for use from the Electron main process. */
export class NodeProjectFileLister implements ProjectFileLister {
  async list(directoryPath: string): Promise<string[]> {
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => join(directoryPath, entry.name));
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new ProjectFileNotFoundError(directoryPath);
      }
      throw new ProjectFileReadError(directoryPath, { cause: error });
    }
  }
}
