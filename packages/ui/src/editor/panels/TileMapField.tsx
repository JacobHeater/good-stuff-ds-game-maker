import { useEffect, useState } from "react";

import { getSpriteFrames, getTileMap, isTileSolid, TILE_MAP_MAX_COLUMNS, TILE_MAP_MAX_ROWS, tileAt, type ImportedSprite, type SceneNode } from "@goodstuff/core";

import { spriteFrameDataUrl } from "../viewport/sprite-image";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

const CELL_PX = 16;

/**
 * A TileMap's sheet, grid and per-tile solidity (requirements/scene-designer/STORY.standalone-2d-tilemaps.md): choose or
 * import a tile sheet (an 8 x 8 sheet, imported the same way an AnimatedSprite2D's is), click a tile in the sheet to pick
 * it as the brush (or the eraser), drag across the grid below to paint it, and mark a sheet tile solid for tile_solid().
 */
export function TileMapField({
  node,
  sprites,
  onChoose,
  onImport,
  onResize,
  onPaint,
  onSetSolid
}: {
  node: SceneNode;
  sprites: readonly ImportedSprite[];
  onChoose: (spriteId: string | null) => void;
  onImport: () => void;
  onResize: (columns: number, rows: number) => void;
  onPaint: (column: number, row: number, tile: number) => void;
  onSetSolid: (tile: number, value: boolean) => void;
}): JSX.Element {
  const data = getTileMap(node);
  const sheet = sprites.find((s) => s.id === data.spriteId);
  const missing = data.spriteId !== undefined && !sheet;
  const frames = sheet ? getSpriteFrames(sheet) : null;
  const [brush, setBrush] = useState(0);
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const stop = (): void => setPainting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const paintAt = (column: number, row: number): void => onPaint(column, row, brush);

  return (
    <div className="flex flex-col gap-2" data-testid="tilemap-field">
      <Field label="Tile sheet">
        <select value={data.spriteId ?? ""} onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)} className={inputClasses}>
          <option value="">None</option>
          {sprites.map((sprite) => (
            <option key={sprite.id} value={sprite.id}>
              {sprite.name} ({getSpriteFrames(sprite).count} tiles)
            </option>
          ))}
          {missing && (
            <option value={data.spriteId} disabled>
              (missing image)
            </option>
          )}
        </select>
      </Field>
      <button type="button" className={buttonClasses} onClick={onImport} data-testid="import-tileset">
        Import tile sheet PNG...
      </button>
      {!sheet && !missing && <div className="text-[11px] text-editor-text-muted">No tile sheet: nothing is drawn for this TileMap in the ROM.</div>}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Columns">
          <input
            type="number"
            min={1}
            max={TILE_MAP_MAX_COLUMNS}
            value={data.columns}
            onChange={(event) => onResize(Number(event.target.value), data.rows)}
            className={inputClasses}
          />
        </Field>
        <Field label="Rows">
          <input type="number" min={1} max={TILE_MAP_MAX_ROWS} value={data.rows} onChange={(event) => onResize(data.columns, Number(event.target.value))} className={inputClasses} />
        </Field>
      </div>

      {sheet && frames && (
        <>
          <div className="text-[11px] font-semibold text-editor-text">Tiles (click to pick the brush; the checkbox marks it solid ground for tile_solid())</div>
          <div className="flex flex-wrap gap-1" data-testid="tile-palette">
            <button
              type="button"
              onClick={() => setBrush(-1)}
              title="Eraser"
              className={`flex items-center justify-center border text-[10px] text-editor-text-muted ${brush === -1 ? "border-editor-accent" : "border-editor-border"}`}
              style={{ width: frames.frameWidth * 2, height: frames.frameHeight * 2 }}
            >
              ×
            </button>
            {Array.from({ length: frames.count }, (_, tile) => {
              const url = spriteFrameDataUrl(sheet, tile);
              const solid = isTileSolid(data, tile);
              return (
                <div key={tile} className="flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setBrush(tile)}
                    data-testid={`tile-${tile}`}
                    className={`border ${brush === tile ? "border-editor-accent" : "border-editor-border"}`}
                    style={{ width: frames.frameWidth * 2, height: frames.frameHeight * 2 }}
                  >
                    {url && <img src={url} alt="" className="h-full w-full" style={{ imageRendering: "pixelated" }} />}
                  </button>
                  <input type="checkbox" checked={solid} onChange={(event) => onSetSolid(tile, event.target.checked)} aria-label={`Tile ${tile} solid`} title="Solid ground" />
                </div>
              );
            })}
          </div>

          <div className="text-[11px] font-semibold text-editor-text">Grid</div>
          <div
            className="inline-grid border border-editor-border bg-black/60 select-none"
            data-testid="tile-grid"
            style={{ gridTemplateColumns: `repeat(${data.columns}, ${CELL_PX}px)`, gridTemplateRows: `repeat(${data.rows}, ${CELL_PX}px)`, width: data.columns * CELL_PX }}
          >
            {Array.from({ length: data.columns * data.rows }, (_, index) => {
              const column = index % data.columns;
              const row = Math.floor(index / data.columns);
              const tile = tileAt(data, column, row);
              const url = tile >= 0 ? spriteFrameDataUrl(sheet, tile) : null;
              return (
                <div
                  key={index}
                  data-testid={`cell-${column}-${row}`}
                  className="border border-white/10"
                  style={{ width: CELL_PX, height: CELL_PX }}
                  onMouseDown={() => {
                    setPainting(true);
                    paintAt(column, row);
                  }}
                  onMouseEnter={() => {
                    if (painting) paintAt(column, row);
                  }}
                >
                  {url && <img src={url} alt="" className="h-full w-full" style={{ imageRendering: "pixelated" }} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
