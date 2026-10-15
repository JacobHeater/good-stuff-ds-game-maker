import type { PrimitiveGeometry } from "./primitive-geometry";

/**
 * A 3D model brought in from a file, stored inside the project (see
 * requirements/persistence/TASK.embed-imported-meshes-in-project-file.md).
 *
 * The data is indexed to keep the project file small: `positions` and `normals` hold one unique vertex
 * per three floats (the same vertex index in both), and `indices` lists triangles as three vertex
 * indices each, counter-clockwise seen from outside. Plain numbers only, since this is written straight
 * into the project's JSON.
 */
export interface ImportedMesh {
  id: string;
  /** What the user calls it; the file's name without its extension. */
  name: string;
  /** x, y, z per unique vertex. */
  positions: number[];
  /** x, y, z per unique vertex, unit length. Same length as `positions`. */
  normals: number[];
  /** u, v per unique vertex, in image space (v runs top to bottom); absent when the model has no texture coordinates. */
  uvs?: number[];
  /** Three vertex indices per triangle. */
  indices: number[];
  /**
   * More poses of the same model, after the first (which is `positions` and `normals`): a model imported from several .obj files that share their triangles (requirements/scene-designer/STORY.animated-3d-models.md).
   * Each has as many vertices as the first; only where they are and which way they face changes. Absent for a model with one pose.
   */
  frames?: ImportedMeshFrame[];
  /**
   * How a rigged import's vertices are actually weighted across bones, carried along even though the mesh's own
   * `positions` are always rigidly stored in just its one assigned bone's space (see `gltf-import.ts`'s own "pulls
   * its vertices hardest" rule) -- so a `MeshInstance3DData.smoothSkinning` toggle can later ask for a true weighted
   * blend without re-importing the file. Absent for a model with no skin, or one imported before this existed (both
   * mean "rigid only," same as today). `requirements/scene-designer/STORY.smooth-vertex-skinning.md`.
   */
  skin?: ImportedMeshSkin;
}

export interface ImportedMeshSkin {
  /** The small set of bones (by `SceneNode.id`) this mesh's vertices actually reference -- usually just a handful, not the whole skeleton. */
  jointNodeIds: string[];
  /**
   * One 4x4 matrix (16 floats, column-major) per entry in `jointNodeIds`, already expressed relative to this mesh's
   * own `positions` space (not the file's raw inverse bind matrices) -- so the blended skinning matrix for a vertex
   * is simply `Σ weight_i · jointNodeIds[i]'s current world matrix · inverseBindMatrices[i]`, applied directly to
   * that vertex's stored (already-in-one-bone's-space) position, with no extra change of space needed.
   */
  inverseBindMatrices: number[];
  /** 4 per vertex (same vertex order as `positions`), indices into `jointNodeIds`; unused slots are 0 with a matching 0 weight. */
  joints: number[];
  /** 4 per vertex, normalized to sum to 1 across the 4 slots. */
  weights: number[];
}

/** One more pose of an imported model: the vertices' places and normals (the triangles and texture coordinates are the model's own). */
export interface ImportedMeshFrame {
  positions: number[];
  normals: number[];
}

/** How many poses the model has (1 for an ordinary model). */
export function getImportedFrameCount(mesh: ImportedMesh): number {
  return 1 + (mesh.frames?.length ?? 0);
}

const frameExpanded = new WeakMap<ImportedMesh, PrimitiveGeometry[]>();

/** The triangle list of pose `frame` (0 is the first). Built once per model and shared; do not mutate it. An out-of-range frame gives the first. */
export function getImportedMeshFrameGeometry(mesh: ImportedMesh, frame: number): PrimitiveGeometry {
  if (frame <= 0 || !mesh.frames?.[frame - 1]) return getImportedMeshGeometry(mesh);
  let cache = frameExpanded.get(mesh);
  if (!cache) {
    cache = [];
    frameExpanded.set(mesh, cache);
  }
  if (!cache[frame]) {
    const pose = mesh.frames[frame - 1];
    const base = getImportedMeshGeometry(mesh);
    const positions: number[] = [];
    const normals: number[] = [];
    for (const index of mesh.indices) {
      positions.push(pose.positions[index * 3], pose.positions[index * 3 + 1], pose.positions[index * 3 + 2]);
      normals.push(pose.normals[index * 3], pose.normals[index * 3 + 1], pose.normals[index * 3 + 2]);
    }
    cache[frame] = { positions, normals, ...(base.uvs ? { uvs: base.uvs } : {}), triangleCount: base.triangleCount };
  }
  return cache[frame];
}

/**
 * Puts models that are poses of one another into one model with several frames, in the order given. They must have exactly the same triangles: the same number of vertices and the same
 * indices (and texture coordinates); only the vertices' places may differ. The first is the model's name and texture coordinates.
 */
export function mergeMeshFrames(meshes: readonly ImportedMesh[]): { ok: true; mesh: ImportedMesh } | { ok: false; errors: string[] } {
  if (meshes.length === 0) return { ok: false, errors: ["There are no models to put together."] };
  const [first, ...rest] = meshes;
  const errors: string[] = [];
  for (const other of rest) {
    if (other.positions.length !== first.positions.length) {
      errors.push(`"${other.name}" has ${other.positions.length / 3} vertices, but "${first.name}" has ${first.positions.length / 3}. Frames of one model must have the same vertices.`);
    } else if (other.indices.length !== first.indices.length || other.indices.some((index, i) => index !== first.indices[i])) {
      errors.push(`"${other.name}" has different triangles from "${first.name}". Frames of one model must be built from the same triangles (only moved), in the same order.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, mesh: { ...first, ...(rest.length > 0 ? { frames: rest.map((other) => ({ positions: other.positions, normals: other.normals })) } : {}) } };
}

/**
 * The largest magnitude a vertex coordinate can have: the DS's `v16` format is 4.12 fixed point, so
 * 32767/4096. Models are unit-scale in practice; anything larger is refused at import.
 */
export const MAX_IMPORTED_COORDINATE = 32767 / 4096;

export function getImportedTriangleCount(mesh: ImportedMesh): number {
  return Math.floor(mesh.indices.length / 3);
}

const expanded = new WeakMap<ImportedMesh, PrimitiveGeometry>();

/**
 * The model as the plain triangle list every consumer draws from (the same shape as a primitive's
 * geometry). Built once per mesh object and shared; do not mutate it.
 */
export function getImportedMeshGeometry(mesh: ImportedMesh): PrimitiveGeometry {
  let geometry = expanded.get(mesh);
  if (!geometry) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] | undefined = mesh.uvs ? [] : undefined;
    const skinJoints: number[] | undefined = mesh.skin ? [] : undefined;
    const skinWeights: number[] | undefined = mesh.skin ? [] : undefined;
    for (const index of mesh.indices) {
      positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
      normals.push(mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]);
      uvs?.push(mesh.uvs![index * 2], mesh.uvs![index * 2 + 1]);
      for (let k = 0; k < 4; k++) {
        skinJoints?.push(mesh.skin!.joints[index * 4 + k]);
        skinWeights?.push(mesh.skin!.weights[index * 4 + k]);
      }
    }
    geometry = {
      positions,
      normals,
      ...(uvs ? { uvs } : {}),
      triangleCount: getImportedTriangleCount(mesh),
      ...(mesh.skin ? { skin: { jointNodeIds: mesh.skin.jointNodeIds, inverseBindMatrices: mesh.skin.inverseBindMatrices }, skinJoints, skinWeights } : {})
    };
    expanded.set(mesh, geometry);
  }
  return geometry;
}
