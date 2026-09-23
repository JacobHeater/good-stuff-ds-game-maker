import type { SceneNode } from "./scene-node";

/**
 * A project's rendering pipeline, chosen once at creation and permanent
 * for the life of the project — see
 * requirements/startup-view/STORY.new-project-flow-with-mode-commitment.md.
 */
export type ProjectMode = "2D" | "3D";

/**
 * Bump this whenever `ProjectSnapshot`'s shape changes in a way that
 * would break reading an older saved file, so loaders can detect and
 * migrate (or reject) outdated files instead of silently misreading them.
 */
export const PROJECT_SNAPSHOT_FORMAT_VERSION = 1 as const;

/**
 * Everything needed to save and fully reconstitute one open project.
 *
 * This closes a gap that used to exist between `GameProject` (project
 * metadata only) and `SceneNode` (the actual editable tree, held only in
 * live editor state, never attached to a project) — a project snapshot
 * carries both, plus the format version and the project's permanent mode.
 * Every field here must remain plain, JSON-serializable data (no
 * functions, class instances, `Map`/`Set`) since this is the shape
 * written directly to and read directly from a project file.
 */
export interface ProjectSnapshot {
  formatVersion: typeof PROJECT_SNAPSHOT_FORMAT_VERSION;
  id: string;
  name: string;
  mode: ProjectMode;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  scene: SceneNode;
}

/** Creates a brand-new project snapshot, stamping fresh id/timestamps. */
export function createProjectSnapshot(params: { name: string; mode: ProjectMode; scene: SceneNode }): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    formatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION,
    id: crypto.randomUUID(),
    name: params.name,
    mode: params.mode,
    createdAt: now,
    updatedAt: now,
    scene: params.scene
  };
}

/** Returns a copy of `snapshot` with a new scene tree and a bumped `updatedAt`. */
export function withUpdatedScene(snapshot: ProjectSnapshot, scene: SceneNode): ProjectSnapshot {
  return { ...snapshot, scene, updatedAt: new Date().toISOString() };
}
