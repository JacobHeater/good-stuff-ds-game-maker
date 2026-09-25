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
    for (const index of mesh.indices) {
      positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
      normals.push(mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]);
      uvs?.push(mesh.uvs![index * 2], mesh.uvs![index * 2 + 1]);
    }
    geometry = { positions, normals, ...(uvs ? { uvs } : {}), triangleCount: getImportedTriangleCount(mesh) };
    expanded.set(mesh, geometry);
  }
  return geometry;
}
