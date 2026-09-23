import { ProjectFileNotFoundError } from "../errors";
import type { ProjectFileLister } from "../ports/project-file-lister";
import type { ProjectFileReader } from "../ports/project-file-reader";
import type { ProjectFileWriter } from "../ports/project-file-writer";

/**
 * In-memory ProjectFileReader/Writer/Lister, for tests and previews.
 *
 * It implements the same three port interfaces as the Node-backed
 * classes and honors the exact same error contract (e.g.
 * `ProjectFileNotFoundError` on a missing path, never a bespoke error).
 * That's what makes it a genuine Liskov substitute rather than just a
 * same-shaped stand-in: code written against `ProjectFileReader` (or
 * `Writer`/`Lister`) behaves identically whether it's handed this or
 * `NodeProjectFileReader` — including how it fails — without knowing or
 * caring which one it got.
 */
export class InMemoryProjectFileStore implements ProjectFileReader, ProjectFileWriter, ProjectFileLister {
  private readonly files = new Map<string, string>();

  async read(path: string): Promise<string> {
    const contents = this.files.get(path);
    if (contents === undefined) {
      throw new ProjectFileNotFoundError(path);
    }
    return contents;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async list(directoryPath: string): Promise<string[]> {
    const prefix = directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;
    return [...this.files.keys()].filter((path) => path.startsWith(prefix));
  }
}
