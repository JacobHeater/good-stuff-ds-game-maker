import { describe, expect, it } from "vitest";

import { getTileMap, isTileSolid, resizeTileMapGrid, setTileSolid, tileAt, type TileMapData } from "./tile-map";

describe("getTileMap", () => {
  it("defaults to an empty 32 x 24 grid with no sheet", () => {
    const data = getTileMap({});
    expect(data).toEqual({ spriteId: undefined, columns: 32, rows: 24, tiles: new Array(32 * 24).fill(-1), solid: [] });
  });

  it("clamps columns and rows to 1..32, padding or truncating the grid to match", () => {
    const data = getTileMap({ tileMap: { columns: 100, rows: 0, tiles: [5] } });
    expect(data.columns).toBe(32);
    expect(data.rows).toBe(1);
    expect(data.tiles).toHaveLength(32);
    expect(data.tiles[0]).toBe(5);
    expect(data.tiles[1]).toBe(-1);
  });

  it("keeps a chosen sheet and tile grid as given", () => {
    const data = getTileMap({ tileMap: { spriteId: "tiles", columns: 2, rows: 1, tiles: [3, -1] } });
    expect(data).toEqual({ spriteId: "tiles", columns: 2, rows: 1, tiles: [3, -1], solid: [] });
  });
});

describe("tileAt", () => {
  const grid: Pick<TileMapData, "columns" | "rows" | "tiles"> = { columns: 2, rows: 2, tiles: [0, 1, 2, 3] };
  it("reads a cell by column and row, row-major", () => {
    expect(tileAt(grid, 0, 0)).toBe(0);
    expect(tileAt(grid, 1, 0)).toBe(1);
    expect(tileAt(grid, 0, 1)).toBe(2);
    expect(tileAt(grid, 1, 1)).toBe(3);
  });
  it("is -1 off the grid", () => {
    expect(tileAt(grid, -1, 0)).toBe(-1);
    expect(tileAt(grid, 2, 0)).toBe(-1);
    expect(tileAt(grid, 0, 2)).toBe(-1);
  });
});

describe("resizeTileMapGrid", () => {
  it("keeps each existing cell at the same column/row, filling new cells empty", () => {
    const data: TileMapData = { columns: 2, rows: 2, tiles: [0, 1, 2, 3], solid: [] };
    const grown = resizeTileMapGrid(data, 3, 2);
    expect(grown.columns).toBe(3);
    expect(grown.tiles).toEqual([0, 1, -1, 2, 3, -1]);
  });

  it("drops cells outside the new size", () => {
    const data: TileMapData = { columns: 2, rows: 2, tiles: [0, 1, 2, 3], solid: [] };
    const shrunk = resizeTileMapGrid(data, 1, 1);
    expect(shrunk.tiles).toEqual([0]);
  });

  it("clamps the requested size to 1..32", () => {
    const data: TileMapData = { columns: 1, rows: 1, tiles: [0], solid: [] };
    expect(resizeTileMapGrid(data, 100, 0)).toMatchObject({ columns: 32, rows: 1 });
  });
});

describe("isTileSolid / setTileSolid", () => {
  it("is false for anything not explicitly marked, including out of range", () => {
    const data: TileMapData = { columns: 1, rows: 1, tiles: [0], solid: [false, true] };
    expect(isTileSolid(data, 0)).toBe(false);
    expect(isTileSolid(data, 1)).toBe(true);
    expect(isTileSolid(data, 5)).toBe(false);
    expect(isTileSolid(data, -1)).toBe(false);
  });

  it("grows the array to set a flag past its current end", () => {
    const data: TileMapData = { columns: 1, rows: 1, tiles: [0], solid: [] };
    const next = setTileSolid(data, 2, true);
    expect(next.solid).toEqual([false, false, true]);
  });
});
