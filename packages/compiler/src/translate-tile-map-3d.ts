import {
  getMeshDiffuseLevels,
  getTileMap3D,
  isTileSolid3D,
  listCells3D,
  resolveMeshGeometry,
  resolveMeshTexture,
  TILE_MAP_3D_CHUNK_SIZE,
  chunkKey,
  chunkOf,
  type ImportedTexture,
  type MeshInstance3DData,
  type ProjectSnapshot,
  type SceneNode
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import type { DsTileMap3D, DsTileMap3DPaletteEntry } from "./ds-scene";
import { rgb15 } from "./fixed-point";

/** 2 bytes a cell (palette index + 1, 0 = empty; then its rotation), CHUNK_SIZE^3 cells -- the chunk file format a running ROM streams in (STORY.tile-map-3d.md's Phase 2/3). */
const BYTES_PER_CELL = 2;
const CELLS_PER_CHUNK = TILE_MAP_3D_CHUNK_SIZE * TILE_MAP_3D_CHUNK_SIZE * TILE_MAP_3D_CHUNK_SIZE;

export interface CompiledTileMaps3D {
  tileMaps: DsTileMap3D[];
  paletteEntries: DsTileMap3DPaletteEntry[];
  /** Keyed by the chunk's own full path (`chunkPathPrefix` already included) -- ready to pass straight into `RomBuilder`'s own `nitroFiles` option. */
  chunkFiles: Record<string, Uint8Array>;
}

/**
 * Compiles every TileMap3D node's own palette (through exactly the same `indexOfPrimitive`/`indexOfTexture`
 * machinery a plain MeshInstance3D's mesh/texture already goes through -- these are shared, deduplicated tables,
 * the same source model used by ten thousand painted cells is still stored once) and chunks its painted cells into
 * dense binary files, one per non-empty chunk, instead of compiling them in (STORY.tile-map-3d.md).
 */
export function compileTileMap3D(
  tileMaps3D: readonly { node: SceneNode; index: number }[],
  project: ProjectSnapshot,
  sceneIndex: number,
  diagnostics: Diagnostic[],
  indexOfPrimitive: (mesh: MeshInstance3DData) => number,
  indexOfTexture: (texture: ImportedTexture) => number
): CompiledTileMaps3D {
  const tileMaps: DsTileMap3D[] = [];
  const paletteEntries: DsTileMap3DPaletteEntry[] = [];
  const chunkFiles: Record<string, Uint8Array> = {};

  tileMaps3D.forEach(({ node, index: nodeIndex }, tileMapIndex) => {
    const data = getTileMap3D(node);
    const paletteStart = paletteEntries.length;
    // A palette entry naming a mesh the project doesn't have becomes a harmless "always empty" slot (never matched
    // by a real primitive index) rather than throwing: indexOfPrimitive/resolveMeshGeometry assume a resolvable
    // mesh, the same assumption a plain MeshInstance3D's own "missing-model" error already exists to report instead
    // of crashing on.
    const localIndexByPaletteId = new Map<string, number>();
    data.palette.forEach((entry, i) => {
      const synthetic: MeshInstance3DData = { importedMeshId: entry.importedMeshId, textureId: entry.textureId, color: entry.color, triangleCount: 0 };
      if (!resolveMeshGeometry(synthetic, project.meshes)) {
        diagnostics.push({
          severity: "error",
          code: "tile-map-3d-missing-model",
          nodeName: node.name,
          message: `This TileMap3D's palette entry ${i} uses an imported model that isn't in the project, so nothing can be drawn for it. Import the model again or remove the entry.`
        });
        return;
      }
      const texture = resolveMeshTexture(synthetic, project.textures);
      const levels = getMeshDiffuseLevels(synthetic, texture !== undefined);
      paletteEntries.push({
        primitive: indexOfPrimitive(synthetic),
        texture: texture ? indexOfTexture(texture) : 0,
        diffuse: rgb15(levels[0], levels[1], levels[2]),
        solid: isTileSolid3D(entry)
      });
      localIndexByPaletteId.set(entry.id, paletteEntries.length - 1 - paletteStart);
    });

    // Group every painted cell by its own chunk, then write one dense file per non-empty chunk: 1 (not 0) + the
    // palette's own local index, 0 meaning empty, so a chunk that's mostly sparse still decodes with a single pass
    // and no separate "which cells are painted" list.
    const chunks = new Map<string, Uint8Array>();
    for (const { x, y, z, cell } of listCells3D(data)) {
      const localIndex = localIndexByPaletteId.get(cell.paletteId);
      if (localIndex === undefined) continue; // a dangling reference (the schema normally catches this) -- skip, don't crash
      const { cx, cy, cz } = chunkOf(x, y, z);
      const key = chunkKey(cx, cy, cz);
      let bytes = chunks.get(key);
      if (!bytes) {
        bytes = new Uint8Array(CELLS_PER_CHUNK * BYTES_PER_CELL);
        chunks.set(key, bytes);
      }
      const lx = x - cx * TILE_MAP_3D_CHUNK_SIZE;
      const ly = y - cy * TILE_MAP_3D_CHUNK_SIZE;
      const lz = z - cz * TILE_MAP_3D_CHUNK_SIZE;
      const cellIndex = lx + ly * TILE_MAP_3D_CHUNK_SIZE + lz * TILE_MAP_3D_CHUNK_SIZE * TILE_MAP_3D_CHUNK_SIZE;
      bytes[cellIndex * BYTES_PER_CELL] = localIndex + 1;
      bytes[cellIndex * BYTES_PER_CELL + 1] = cell.rotationY;
    }
    const chunkPathPrefix = `tile3d/${sceneIndex}/${tileMapIndex}/`;
    for (const [key, bytes] of chunks) chunkFiles[`${chunkPathPrefix}${key}.bin`] = bytes;

    tileMaps.push({ node: nodeIndex, paletteStart, paletteCount: paletteEntries.length - paletteStart, chunkPathPrefix });
  });

  return { tileMaps, paletteEntries, chunkFiles };
}
