import { describe, expect, it } from "vitest";

import { cellAt3D, chunkKey, chunkOf, DEFAULT_TILE_MAP_3D, eraseCell3D, getTileMap3D, listCells3D, paintCell3D, TILE_MAP_3D_CHUNK_SIZE, type TileMap3DData } from "./tile-map-3d";

const stone = { paletteId: "stone", rotationY: 0 as const };

describe("getTileMap3D", () => {
  it("defaults to an empty palette and no cells", () => {
    expect(getTileMap3D({})).toEqual(DEFAULT_TILE_MAP_3D);
  });

  it("fills in a missing field but keeps the other", () => {
    const node = { tileMap3D: { cells: { "1,2,3": stone } } };
    expect(getTileMap3D(node)).toEqual({ palette: [], cells: { "1,2,3": stone } });
  });
});

describe("paintCell3D / eraseCell3D / cellAt3D", () => {
  it("paints a cell, and reads it back at the same coordinates", () => {
    const painted = paintCell3D(DEFAULT_TILE_MAP_3D, 1, 2, 3, stone);
    expect(cellAt3D(painted, 1, 2, 3)).toEqual(stone);
    expect(cellAt3D(painted, 1, 2, 4)).toBeNull();
  });

  it("is a no-op (the same object back) when a cell already reads exactly this way", () => {
    const painted = paintCell3D(DEFAULT_TILE_MAP_3D, 0, 0, 0, stone);
    expect(paintCell3D(painted, 0, 0, 0, { ...stone })).toBe(painted);
  });

  it("repaints a different palette entry or rotation at the same cell", () => {
    const painted = paintCell3D(DEFAULT_TILE_MAP_3D, 0, 0, 0, stone);
    const repainted = paintCell3D(painted, 0, 0, 0, { paletteId: "stone", rotationY: 2 });
    expect(cellAt3D(repainted, 0, 0, 0)).toEqual({ paletteId: "stone", rotationY: 2 });
  });

  it("erases a painted cell, and is a no-op on an already-empty one", () => {
    const painted = paintCell3D(DEFAULT_TILE_MAP_3D, 5, -5, 0, stone);
    const erased = eraseCell3D(painted, 5, -5, 0);
    expect(cellAt3D(erased, 5, -5, 0)).toBeNull();
    expect(eraseCell3D(erased, 5, -5, 0)).toBe(erased);
  });

  it("handles negative coordinates distinctly from positive ones", () => {
    const painted = paintCell3D(DEFAULT_TILE_MAP_3D, -1, -1, -1, stone);
    expect(cellAt3D(painted, -1, -1, -1)).toEqual(stone);
    expect(cellAt3D(painted, 1, 1, 1)).toBeNull();
  });
});

describe("chunkOf / chunkKey", () => {
  it("groups cells within one chunk size to the same chunk", () => {
    expect(chunkOf(0, 0, 0)).toEqual({ cx: 0, cy: 0, cz: 0 });
    expect(chunkOf(TILE_MAP_3D_CHUNK_SIZE - 1, 0, 0)).toEqual({ cx: 0, cy: 0, cz: 0 });
    expect(chunkOf(TILE_MAP_3D_CHUNK_SIZE, 0, 0)).toEqual({ cx: 1, cy: 0, cz: 0 });
  });

  it("floor-divides negative coordinates (not truncates), so -1 is its own chunk, not chunk 0", () => {
    expect(chunkOf(-1, 0, 0)).toEqual({ cx: -1, cy: 0, cz: 0 });
    expect(chunkOf(-TILE_MAP_3D_CHUNK_SIZE, 0, 0)).toEqual({ cx: -1, cy: 0, cz: 0 });
    expect(chunkOf(-TILE_MAP_3D_CHUNK_SIZE - 1, 0, 0)).toEqual({ cx: -2, cy: 0, cz: 0 });
  });

  it("names a chunk's own file key from its chunk coordinates", () => {
    expect(chunkKey(1, -2, 3)).toBe("1_-2_3");
  });
});

describe("listCells3D", () => {
  it("parses every well-formed key back to its own coordinates", () => {
    const data: TileMap3DData = { palette: [], cells: { "1,2,3": stone, "-1,-2,-3": { paletteId: "grass", rotationY: 1 } } };
    const list = listCells3D(data);
    expect(list).toHaveLength(2);
    expect(list).toContainEqual({ x: 1, y: 2, z: 3, cell: stone });
    expect(list).toContainEqual({ x: -1, y: -2, z: -3, cell: { paletteId: "grass", rotationY: 1 } });
  });

  it("skips a key that doesn't parse as \"x,y,z\" instead of throwing", () => {
    const data: TileMap3DData = { palette: [], cells: { "not-a-key": stone, "1,2,3": stone } };
    expect(listCells3D(data)).toEqual([{ x: 1, y: 2, z: 3, cell: stone }]);
  });
});
