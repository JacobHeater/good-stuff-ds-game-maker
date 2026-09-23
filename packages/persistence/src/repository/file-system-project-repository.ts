import type { ProjectSnapshot } from "@goodstuff/core";

import type { ProjectFileReader } from "../ports/project-file-reader";
import type { ProjectFileWriter } from "../ports/project-file-writer";
import type { ProjectSerializer } from "../ports/project-serializer";
import type { ProjectSnapshotValidator } from "../ports/project-snapshot-validator";
import type { ProjectRepository } from "./project-repository";

/**
 * Composes the segregated ports into a `ProjectRepository`. Every
 * dependency is injected as an interface, never a concrete class —
 * swap in a different reader/writer (Node-backed, in-memory, a future
 * cloud-backed one), a different serializer (JSON today, something else
 * later), or a different validator (hand-authored schema today,
 * generated later) without touching this class at all, per the
 * Open/Closed and Dependency Inversion principles. This class has
 * exactly one reason to change: the order/logic of composing those four
 * steps, not any of the steps themselves.
 */
export class FileSystemProjectRepository implements ProjectRepository {
  constructor(
    private readonly reader: ProjectFileReader,
    private readonly writer: ProjectFileWriter,
    private readonly serializer: ProjectSerializer,
    private readonly validator: ProjectSnapshotValidator
  ) {}

  async save(path: string, snapshot: ProjectSnapshot): Promise<void> {
    this.validator.assertValid(snapshot);
    const raw = this.serializer.serialize(snapshot);
    await this.writer.write(path, raw);
  }

  async load(path: string): Promise<ProjectSnapshot> {
    const raw = await this.reader.read(path);
    const candidate = this.serializer.deserialize(raw);
    return this.validator.assertValid(candidate);
  }
}
