import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

import { ProjectFileNotFoundError, ProjectFileReadError } from "../errors";
import type { ProjectFileReader } from "../ports/project-file-reader";
import { isErrnoException } from "./node-errno";

/** Node `fs/promises`-backed ProjectFileReader, for use from the Electron main process. */
export class NodeProjectFileReader implements ProjectFileReader {
  async read(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new ProjectFileNotFoundError(path);
      }
      throw new ProjectFileReadError(path, { cause: error });
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
