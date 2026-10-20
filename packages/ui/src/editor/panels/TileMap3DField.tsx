import { getTileMap3D, type ImportedMesh, type ImportedTexture, type SceneNode, type TileMap3DPaletteEntry } from "@goodstuff/core";

import type { TileMap3DBrush } from "../state/editor-store";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

/**
 * A TileMap3D's palette (requirements/scene-designer's own STORY.tile-map-3d.md): each entry names an imported
 * model (and, optionally, a texture/color -- the same choices a plain MeshInstance3D has), and one of them is the
 * Paint tool's active brush. Painting and erasing cells happens in the 3D viewport (TileMap3DPaintController),
 * not here -- this panel only builds the palette and picks the brush, the same division TileMapField (the 2D
 * TileMap's own sheet/grid panel) draws between choosing a tile sheet and painting it.
 */
export function TileMap3DField({
  node,
  meshes,
  textures,
  brush,
  onChangePalette,
  onChangeBrush
}: {
  node: SceneNode;
  meshes: readonly ImportedMesh[];
  textures: readonly ImportedTexture[];
  brush: TileMap3DBrush;
  onChangePalette: (palette: TileMap3DPaletteEntry[]) => void;
  onChangeBrush: (change: Partial<TileMap3DBrush>) => void;
}): JSX.Element {
  const data = getTileMap3D(node);
  const palette = data.palette;

  const addEntry = (): void => {
    if (meshes.length === 0) return;
    const entry: TileMap3DPaletteEntry = { id: crypto.randomUUID(), importedMeshId: meshes[0].id };
    onChangePalette([...palette, entry]);
    onChangeBrush({ paletteId: entry.id });
  };
  const removeEntry = (id: string): void => {
    onChangePalette(palette.filter((entry) => entry.id !== id));
    if (brush.paletteId === id) onChangeBrush({ paletteId: null });
  };
  const updateEntry = (id: string, change: Partial<TileMap3DPaletteEntry>): void => {
    onChangePalette(palette.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  };

  return (
    <div className="flex flex-col gap-2" data-testid="tilemap3d-field">
      <div className="text-[11px] font-semibold text-editor-text">Palette (click a tile to pick the brush)</div>
      {palette.length === 0 && (
        <div className="text-[11px] text-editor-text-muted">No tiles yet: import a model (on a MeshInstance3D, say), then add one below.</div>
      )}
      <div className="flex flex-col gap-2" data-testid="tile3d-palette">
        {palette.map((entry) => {
          const missing = !meshes.some((mesh) => mesh.id === entry.importedMeshId);
          return (
            <div
              key={entry.id}
              data-testid={`tile3d-entry-${entry.id}`}
              className={`flex flex-col gap-1 rounded border p-2 ${brush.paletteId === entry.id ? "border-editor-accent" : "border-editor-border"}`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid={`tile3d-pick-${entry.id}`}
                  title="Pick as the active brush"
                  onClick={() => onChangeBrush({ paletteId: entry.id })}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] ${
                    brush.paletteId === entry.id ? "border-editor-accent bg-editor-accent/20 text-editor-accent" : "border-editor-border text-editor-text-muted"
                  }`}
                >
                  {brush.paletteId === entry.id ? "✓" : ""}
                </button>
                <select
                  value={entry.importedMeshId}
                  onChange={(event) => updateEntry(entry.id, { importedMeshId: event.target.value })}
                  className={`${inputClasses} flex-1`}
                  aria-label="Model"
                >
                  {meshes.map((mesh) => (
                    <option key={mesh.id} value={mesh.id}>
                      {mesh.name}
                    </option>
                  ))}
                  {missing && (
                    <option value={entry.importedMeshId} disabled>
                      (missing model)
                    </option>
                  )}
                </select>
                <button type="button" title="Remove this tile" aria-label="Remove tile" onClick={() => removeEntry(entry.id)} className="px-1 text-editor-text-muted hover:text-editor-text">
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={entry.textureId ?? ""}
                  onChange={(event) => updateEntry(entry.id, { textureId: event.target.value === "" ? undefined : event.target.value })}
                  className={`${inputClasses} flex-1`}
                  aria-label="Texture"
                >
                  <option value="">No texture</option>
                  {textures.map((texture) => (
                    <option key={texture.id} value={texture.id}>
                      {texture.name}
                    </option>
                  ))}
                </select>
                <input type="color" value={entry.color ?? "#ffffff"} onChange={(event) => updateEntry(entry.id, { color: event.target.value })} aria-label="Color" />
                <button type="button" className={buttonClasses} disabled={entry.color === undefined} onClick={() => updateEntry(entry.id, { color: undefined })}>
                  Default
                </button>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-editor-text">
                <input
                  type="checkbox"
                  checked={entry.solid === true}
                  onChange={(event) => updateEntry(entry.id, { solid: event.target.checked })}
                  aria-label={`Tile ${entry.id} solid`}
                  title="Solid ground"
                />
                Solid
              </label>
            </div>
          );
        })}
      </div>
      <button type="button" className={buttonClasses} disabled={meshes.length === 0} onClick={addEntry} data-testid="tile3d-add">
        Add tile
      </button>

      <Field label="Brush rotation (yaw)">
        <button type="button" className={buttonClasses} onClick={() => onChangeBrush({ rotationY: ((brush.rotationY + 1) % 4) as 0 | 1 | 2 | 3 })} data-testid="tile3d-rotate">
          {brush.rotationY * 90}° ↻
        </button>
      </Field>

      <div className="text-[10px] text-editor-text-muted">
        With the Paint tool active: click a tile's face to place the brush next to it (empty ground places on the floor); Shift+click a tile to erase it.
      </div>
    </div>
  );
}
