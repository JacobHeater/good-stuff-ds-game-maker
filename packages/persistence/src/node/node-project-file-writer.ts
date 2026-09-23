import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ProjectFileWriteError } from "../errors";
import type { ProjectFileWriter } from "../ports/project-file-writer";

/** Node `fs/promises`-backed ProjectFileWriter, for use from the Electron main process. */
export class NodeProjectFileWriter implements ProjectFileWriter {
  async write(path: string, contents: string): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf-8");
    } catch (error) {
      throw new ProjectFileWriteError(path, { cause: error });
    }
  }
}
