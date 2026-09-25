import type { ImportedMesh } from "./imported-mesh";
import type { ImportedSound } from "./imported-sound";
import type { ProjectScript } from "./project-script";
import type { ImportedTexture } from "./imported-texture";
import type { ProjectMode } from "./project-mode";
import { flattenSceneTree, type SceneNode } from "./scene-node";

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
  /**
   * 3D models imported into the project, embedded here (not referenced by path) so the project is one
   * file. Absent when there are none, so a project that never imported anything is byte-identical to
   * one saved before models existed. See requirements/persistence/TASK.embed-imported-meshes-in-project-file.md.
   */
  meshes?: ImportedMesh[];
  /**
   * Textures imported into the project, embedded already converted to the DS's format. Absent when there are
   * none. See requirements/persistence/TASK.embed-imported-textures-in-project-file.md.
   */
  textures?: ImportedTexture[];
  /**
   * Sounds imported into the project, embedded already converted (mono, 16-bit). Absent when there are none.
   * See requirements/persistence/TASK.embed-imported-sounds-in-project-file.md.
   */
  sounds?: ImportedSound[];
  /**
   * Scripts the user wrote, embedded here. Absent when there are none. Never dropped for being unattached: they are the user's own work.
   * See requirements/persistence/TASK.embed-scripts-in-project-file.md.
   */
  scripts?: ProjectScript[];
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

/**
 * Returns a copy of `snapshot` with a new scene tree and a bumped `updatedAt`. Imported models, textures and
 * sounds that no node in the new scene uses are dropped, so deleting the last user of one doesn't leave its data
 * in the file; the `meshes`, `textures` and `sounds` keys disappear entirely when none remain.
 */
export function withUpdatedScene(snapshot: ProjectSnapshot, scene: SceneNode): ProjectSnapshot {
  const { meshes, textures, sounds, ...rest } = snapshot;
  const updated: ProjectSnapshot = { ...rest, scene, updatedAt: new Date().toISOString() };
  const nodes = flattenSceneTree(scene);
  if (meshes && meshes.length > 0) {
    const used = new Set(nodes.flatMap((node) => (node.mesh?.importedMeshId ? [node.mesh.importedMeshId] : [])));
    const kept = meshes.filter((mesh) => used.has(mesh.id));
    if (kept.length > 0) updated.meshes = kept;
  }
  if (textures && textures.length > 0) {
    const used = new Set(nodes.flatMap((node) => (node.mesh?.textureId ? [node.mesh.textureId] : [])));
    const kept = textures.filter((texture) => used.has(texture.id));
    if (kept.length > 0) updated.textures = kept;
  }
  if (sounds && sounds.length > 0) {
    const used = new Set(nodes.flatMap((node) => (node.audio?.soundId ? [node.audio.soundId] : [])));
    const kept = sounds.filter((sound) => used.has(sound.id));
    if (kept.length > 0) updated.sounds = kept;
  }
  return updated;
}
