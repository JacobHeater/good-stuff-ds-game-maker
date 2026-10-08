/**
 * A TileMap (requirements/scene-designer/EPIC.full-2d-games.md, STORY.standalone-2d-tilemaps.md): one scrollable grid of
 * 8 x 8 tiles drawn with the DS's background hardware (not the sprite engine every other 2D node uses), so a level can be
 * bigger than one screen's worth of sprites without spending the OAM sprite budget on it.
 *
 * A tile is one frame of an imported sheet (`spriteId`, the same `ImportedSprite` a Sprite2D/AnimatedSprite2D's sheet already
 * is -- import it the same way, with a frame size of 8 x 8), read left to right, top to bottom, numbered from 0 exactly as
 * `getSpriteFrames`/`getSpriteFramePixels` already do. `tiles` is the grid itself, `columns * rows` entries in row-major
 * order, each a frame index or -1 for an empty cell. `solid` marks which *tile* (not which cell) is solid ground for a
 * script's `tile_solid(x, y)` to find -- one entry per frame of the sheet, so painting the same tile in a hundred cells
 * only needs marking solid once.
 *
 * v1 is a single layer, up to 32 x 32 tiles (one DS background screen block, 256 x 256 pixels -- the hardware's smallest,
 * simplest background size, chosen so the real device's memory layout stays simple and well inside budget; a bigger map
 * is a later, separate piece of work, not a small extension of this). Up to 15 colors (plus transparent): a background
 * tile layer reads the DS's shared, bank-wide palette through one of its 16 sub-palettes (4 bits a pixel), unlike a
 * sprite's independent 255-color extended palette, so this is a hardware ceiling, not an arbitrary choice.
 */
export const TILE_SIZE = 8;
export const TILE_MAP_MAX_COLUMNS = 32;
export const TILE_MAP_MAX_ROWS = 32;
export const TILE_MAP_MAX_COLORS = 15;
/** The runtime reserves one 16 KB character block for a screen's tile graphics (32 bytes a 4bpp tile, one slot reserved as an always-blank tile). */
export const TILE_MAP_MAX_TILES = 511;

export interface TileMapData {
  /** The sheet of tile pictures (an `ImportedSprite` with 8 x 8 frames), or absent: nothing is drawn. */
  spriteId?: string;
  columns: number;
  rows: number;
  /** `columns * rows` entries, row by row: a frame index into the sheet, or -1 for an empty cell. */
  tiles: number[];
  /** One entry a sheet frame index, `true` when that tile is solid ground (`tile_solid()`). Absent for a frame means not solid. */
  solid: boolean[];
}

export const DEFAULT_TILE_MAP: Readonly<TileMapData> = { columns: 32, rows: 24, tiles: [], solid: [] };

function clampColumns(value: number): number {
  return Math.min(TILE_MAP_MAX_COLUMNS, Math.max(1, Math.round(value)));
}

function clampRows(value: number): number {
  return Math.min(TILE_MAP_MAX_ROWS, Math.max(1, Math.round(value)));
}

/** `tiles`/`solid` padded with empty/false or truncated to the lengths `columns`/`rows` (and the sheet) call for. */
function normalizeTileMap(data: TileMapData): TileMapData {
  const columns = clampColumns(data.columns);
  const rows = clampRows(data.rows);
  const cells = columns * rows;
  const tiles = Array.from({ length: cells }, (_, i) => (Number.isInteger(data.tiles[i]) ? data.tiles[i] : -1));
  return { spriteId: data.spriteId, columns, rows, tiles, solid: data.solid.map((value) => value === true) };
}

/** A node's tile map with the defaults filled in and the grid normalized. */
export function getTileMap(node: { tileMap?: Partial<TileMapData> }): TileMapData {
  const data = node.tileMap ?? {};
  return normalizeTileMap({
    spriteId: data.spriteId,
    columns: data.columns ?? DEFAULT_TILE_MAP.columns,
    rows: data.rows ?? DEFAULT_TILE_MAP.rows,
    tiles: data.tiles ?? DEFAULT_TILE_MAP.tiles,
    solid: data.solid ?? DEFAULT_TILE_MAP.solid
  });
}

/** The tile at a cell (row-major), or -1 if the cell is out of range. */
export function tileAt(data: Pick<TileMapData, "columns" | "rows" | "tiles">, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= data.columns || row >= data.rows) return -1;
  return data.tiles[row * data.columns + column] ?? -1;
}

/** `tiles` resized to new dimensions, keeping each existing cell at the same column/row (cells outside the new size are dropped; new ones start empty). */
export function resizeTileMapGrid(data: TileMapData, columns: number, rows: number): TileMapData {
  const nextColumns = clampColumns(columns);
  const nextRows = clampRows(rows);
  const tiles = Array.from({ length: nextColumns * nextRows }, (_, i) => {
    const column = i % nextColumns;
    const row = Math.floor(i / nextColumns);
    return column < data.columns && row < data.rows ? tileAt(data, column, row) : -1;
  });
  return { ...data, columns: nextColumns, rows: nextRows, tiles };
}

/** Whether a sheet frame index is marked solid ground. Anything not explicitly marked (including out of range) is not solid. */
export function isTileSolid(data: Pick<TileMapData, "solid">, tile: number): boolean {
  return tile >= 0 && data.solid[tile] === true;
}

/** `solid` with one entry's flag changed, growing the array if the tile is past its current end. The same `data` back when the flag already reads as `value` (including an unmarked tile past the array's end already reading as not solid). */
export function setTileSolid(data: TileMapData, tile: number, value: boolean): TileMapData {
  if (tile < 0 || isTileSolid(data, tile) === value) return data;
  const solid = [...data.solid];
  while (solid.length <= tile) solid.push(false);
  solid[tile] = value;
  return { ...data, solid };
}
