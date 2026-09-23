import type { ProjectSnapshot } from "@goodstuff/core";

/**
 * High-level façade over reading/writing a single project. Consumers
 * (Save/Save As/Open UI wiring) should depend on this, not on the
 * lower-level ports directly — how a `ProjectRepository` is composed
 * from `ProjectFileReader`/`Writer`/`ProjectSerializer`/`ProjectSnapshotValidator`
 * is an implementation detail it's free to change.
 */
export interface ProjectRepository {
  save(path: string, snapshot: ProjectSnapshot): Promise<void>;
  load(path: string): Promise<ProjectSnapshot>;
}
