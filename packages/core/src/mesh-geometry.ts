import { getImportedMeshGeometry, type ImportedMesh } from "./imported-mesh";
import type { ImportedTexture } from "./imported-texture";
import { getPrimitiveGeometry, type PrimitiveGeometry } from "./primitive-geometry";
import type { MeshInstance3DData } from "./scene-node";

/** Where a mesh instance's geometry comes from, as a stable key: one vertex table per distinct key. */
export function meshSourceKey(mesh: MeshInstance3DData): string {
  return mesh.importedMeshId !== undefined ? `imported:${mesh.importedMeshId}` : `primitive:${mesh.primitive}`;
}

/**
 * THE way to get a mesh instance's geometry, from either a built-in primitive or an imported model.
 * The viewport draws it, the hardware budget counts it, the compiler emits it and the emulator test's
 * reference render projects it, so what is drawn, counted and built can't disagree. Returns undefined
 * for a mesh that names a model the project doesn't contain (or has no source at all); callers decide
 * how to report that.
 */
export function resolveMeshGeometry(
  mesh: MeshInstance3DData,
  importedMeshes: readonly ImportedMesh[] | undefined
): PrimitiveGeometry | undefined {
  if (mesh.importedMeshId !== undefined) {
    const found = importedMeshes?.find((candidate) => candidate.id === mesh.importedMeshId);
    return found ? getImportedMeshGeometry(found) : undefined;
  }
  return mesh.primitive ? getPrimitiveGeometry(mesh.primitive) : undefined;
}

/** The texture a mesh instance is drawn with, or undefined when it has none (or names one the project lacks). */
export function resolveMeshTexture(
  mesh: MeshInstance3DData,
  textures: readonly ImportedTexture[] | undefined
): ImportedTexture | undefined {
  return mesh.textureId === undefined ? undefined : textures?.find((candidate) => candidate.id === mesh.textureId);
}

/** A name for the mesh's source, for messages and generated comments. */
export function describeMeshSource(mesh: MeshInstance3DData, importedMeshes: readonly ImportedMesh[] | undefined): string {
  if (mesh.importedMeshId !== undefined) {
    return importedMeshes?.find((candidate) => candidate.id === mesh.importedMeshId)?.name ?? "missing model";
  }
  return mesh.primitive ?? "no mesh";
}
