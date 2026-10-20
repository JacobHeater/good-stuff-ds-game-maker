/**
 * A TileMap3D (requirements/scene-designer/STORY.tile-map-3d.md): a 3D grid of mesh "tiles" from a small palette,
 * painted cell by cell, like Godot's GridMap. Unlike the 2D TileMap (one bounded grid, drawn wholesale), this one is
 * meant to be painted far larger than any one frame could ever draw or than main RAM could ever hold resident: the
 * compiler packs it into per-chunk files in the ROM's own NitroFS region instead of compiling it in, and the
 * runtime streams in only the chunks near the camera, evicting the rest (STORY.tile-map-3d.md's own Phase 3) -- so
 * `cells` here is sparse (a real painted world is mostly empty space), keyed by cell, not a dense array.
 *
 * A cell's rotation is Y-axis (yaw) only, in quarter turns (0..3), matching GridMap's own common case: full,
 * arbitrary per-axis orientation is real but rare for tile-grid content, and this engine's own rotation
 * conventions elsewhere (a node's `rotation.y`) already favor yaw-only turns for exactly this kind of content.
 */

/** One entry of the tile palette: a mesh (and optional texture/color, same as a plain MeshInstance3D) a cell can be painted with. */
export interface TileMap3DPaletteEntry {
  id: string;
  /** The id of an imported model in the project's `meshes` (see `imported-mesh.ts`). */
  importedMeshId: string;
  /** The id of a texture in the project's `textures`; absent for an untextured tile. */
  textureId?: string;
  /** "#rrggbb": the tile's diffuse color (see `mesh-color.ts`); absent for the default. */
  color?: string;
  /** Whether a cell painted with this entry is solid ground for a script's `tile_solid_3d(x, y, z)`. Absent means not solid. */
  solid?: boolean;
}

/** Whether a palette entry is solid ground. Absent (or any non-`true` value) means not solid. */
export function isTileSolid3D(entry: Pick<TileMap3DPaletteEntry, "solid">): boolean {
  return entry.solid === true;
}

/** One painted cell: which palette entry, and its yaw (0..3 quarter turns about Y). */
export interface TileMap3DCell {
  paletteId: string;
  rotationY: 0 | 1 | 2 | 3;
}

export interface TileMap3DData {
  palette: TileMap3DPaletteEntry[];
  /** Sparse: keyed by `cellKey3D(x, y, z)`, one entry per painted cell. Absent for an unpainted cell. */
  cells: Record<string, TileMap3DCell>;
}

export const DEFAULT_TILE_MAP_3D: Readonly<TileMap3DData> = { palette: [], cells: {} };

/** Cells are grouped into chunks this many cells to a side for the ROM's own per-chunk NitroFS files (STORY.tile-map-3d.md's Phase 2/3) -- small enough that streaming one in is cheap (512 cells, 2 bytes each is 1 KB), big enough that a real view distance doesn't mean constantly loading new ones. */
export const TILE_MAP_3D_CHUNK_SIZE = 8;
/** A palette is a `uint8_t` index on the wire (`scene.h`), 0 reserved for "empty" (STORY.tile-map-3d.md's chunk file format): at most this many real tiles. */
export const TILE_MAP_3D_MAX_PALETTE = 254;

const cellKey3D = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Which chunk a cell belongs to, as the chunk's own origin cell (its lowest x/y/z) -- floor division, so negative coordinates chunk the same way positive ones do. */
export function chunkOf(x: number, y: number, z: number): { cx: number; cy: number; cz: number } {
  const floorDiv = (v: number): number => Math.floor(v / TILE_MAP_3D_CHUNK_SIZE);
  return { cx: floorDiv(x), cy: floorDiv(y), cz: floorDiv(z) };
}

/** The chunk key a chunk's own origin cell maps to -- the NitroFS file name a chunk is written/read as (STORY.tile-map-3d.md). */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx}_${cy}_${cz}`;
}

/** A node's tile map with the defaults filled in. */
export function getTileMap3D(node: { tileMap3D?: Partial<TileMap3DData> }): TileMap3DData {
  const data = node.tileMap3D ?? {};
  return { palette: data.palette ?? DEFAULT_TILE_MAP_3D.palette, cells: data.cells ?? DEFAULT_TILE_MAP_3D.cells };
}

/** The cell at (x, y, z), or null when unpainted. */
export function cellAt3D(data: Pick<TileMap3DData, "cells">, x: number, y: number, z: number): TileMap3DCell | null {
  return data.cells[cellKey3D(x, y, z)] ?? null;
}

/** `data` with one cell painted (or repainted with a different palette entry/rotation). A no-op (the same `data` back) if the cell already reads exactly this way. */
export function paintCell3D(data: TileMap3DData, x: number, y: number, z: number, cell: TileMap3DCell): TileMap3DData {
  const key = cellKey3D(x, y, z);
  const current = data.cells[key];
  if (current && current.paletteId === cell.paletteId && current.rotationY === cell.rotationY) return data;
  return { ...data, cells: { ...data.cells, [key]: cell } };
}

/** `data` with one cell erased. The same `data` back if it was already empty. */
export function eraseCell3D(data: TileMap3DData, x: number, y: number, z: number): TileMap3DData {
  const key = cellKey3D(x, y, z);
  if (!(key in data.cells)) return data;
  const cells = { ...data.cells };
  delete cells[key];
  return { ...data, cells };
}

/** Every painted cell, parsed back to its own (x, y, z) alongside its data -- for the compiler, which groups them by chunk (STORY.tile-map-3d.md's Phase 2). A key that doesn't parse as "x,y,z" (never written by `paintCell3D`, but a hand-edited or corrupted file could have one) is skipped, not thrown on. */
export function listCells3D(data: Pick<TileMap3DData, "cells">): Array<{ x: number; y: number; z: number; cell: TileMap3DCell }> {
  const out: Array<{ x: number; y: number; z: number; cell: TileMap3DCell }> = [];
  for (const [key, cell] of Object.entries(data.cells)) {
    const match = /^(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
    if (!match) continue;
    out.push({ x: Number(match[1]), y: Number(match[2]), z: Number(match[3]), cell });
  }
  return out;
}
