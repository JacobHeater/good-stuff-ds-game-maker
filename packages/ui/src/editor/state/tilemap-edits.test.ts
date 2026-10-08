import { createBlankSceneTree, createProjectSnapshot, createSpriteFromRgba, findSceneNode, getTileMap, type ImportedSprite } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
function tileSheet(id: string, columns: number, name = id): ImportedSprite {
  const made = createSpriteFromRgba(new Uint8Array(8 * columns * 8 * 4).fill(200), 8 * columns, 8, { name, frame: { width: 8, height: 8 } });
  if (!made.ok) throw new Error("sheet didn't convert");
  return { id, ...made.sprite };
}

const withTileMap = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "TileMap" });
  return { state, id: state.selectedNodeId };
};
const dataOf = (s: EditorState, id: string) => getTileMap(findSceneNode(s.sceneRoot, id)!);

describe("editing a tile map", () => {
  it("starts empty, 32 x 24, with no sheet", () => {
    const { state, id } = withTileMap();
    expect(dataOf(state, id)).toEqual({ spriteId: undefined, columns: 32, rows: 24, tiles: new Array(32 * 24).fill(-1), solid: [] });
  });

  it("imports a tile sheet into the project and onto the selected TileMap in one step, keeping its grid", () => {
    const { state, id } = withTileMap();
    const painted = run(state, { type: "PAINT_TILE", id, column: 0, row: 0, tile: 3 });
    const sheet = tileSheet("s1", 4, "tiles");
    const imported = run(painted, { type: "IMPORT_SPRITE", nodeId: id, sprite: sheet, warnings: [] });
    expect(imported.project!.sprites).toEqual([sheet]);
    expect(dataOf(imported, id).spriteId).toBe("s1");
    expect(dataOf(imported, id).tiles[0]).toBe(3); // the grid painted before the import is kept
    expect(hasUnsavedChanges(imported)).toBe(true);
  });

  it("chooses an already-imported sheet with SET_TILE_MAP", () => {
    const { state, id } = withTileMap();
    const withSheet: EditorState = { ...state, project: { ...state.project!, sprites: [tileSheet("s1", 2)] } };
    const chosen = run(withSheet, { type: "SET_TILE_MAP", id, change: { spriteId: "s1" } });
    expect(dataOf(chosen, id).spriteId).toBe("s1");
    const cleared = run(chosen, { type: "SET_TILE_MAP", id, change: { spriteId: null } });
    expect(dataOf(cleared, id).spriteId).toBeUndefined();
  });

  it("resizes the grid, keeping each existing cell at its column/row", () => {
    const { state, id } = withTileMap();
    const painted = run(state, { type: "PAINT_TILE", id, column: 0, row: 0, tile: 5 });
    const resized = run(painted, { type: "SET_TILE_MAP", id, change: { columns: 2, rows: 2 } });
    const data = dataOf(resized, id);
    expect(data.columns).toBe(2);
    expect(data.rows).toBe(2);
    expect(data.tiles[0]).toBe(5);
  });

  it("paints one cell at a time, out of range is a no-op, and painting the same tile twice is no edit", () => {
    const { state, id } = withTileMap();
    const painted = run(state, { type: "PAINT_TILE", id, column: 1, row: 0, tile: 7 });
    expect(dataOf(painted, id).tiles[1]).toBe(7);
    expect(run(painted, { type: "PAINT_TILE", id, column: 1, row: 0, tile: 7 })).toBe(painted);
    expect(run(state, { type: "PAINT_TILE", id, column: 100, row: 0, tile: 1 })).toBe(state);
    const erased = run(painted, { type: "PAINT_TILE", id, column: 1, row: 0, tile: -1 });
    expect(dataOf(erased, id).tiles[1]).toBe(-1);
  });

  it("marks a sheet tile solid, growing the array as needed, and setting what it already is is no edit", () => {
    const { state, id } = withTileMap();
    expect(run(state, { type: "SET_TILE_SOLID", id, tile: 3, value: false })).toBe(state);
    const solid = run(state, { type: "SET_TILE_SOLID", id, tile: 3, value: true });
    expect(dataOf(solid, id).solid).toEqual([false, false, false, true]);
    expect(solid.history.past.at(-1)!.label).toBe("Turn solid on for a tile of TileMap");
    const unsolid = run(solid, { type: "SET_TILE_SOLID", id, tile: 3, value: false });
    expect(dataOf(unsolid, id).solid[3]).toBe(false);
  });

  it("only applies to a TileMap", () => {
    const mesh = run(openProject(), { type: "ADD_NODE", kind: "Sprite2D" });
    expect(run(mesh, { type: "SET_TILE_MAP", id: mesh.selectedNodeId, change: { columns: 2 } })).toBe(mesh);
    expect(run(mesh, { type: "PAINT_TILE", id: mesh.selectedNodeId, column: 0, row: 0, tile: 1 })).toBe(mesh);
    expect(run(mesh, { type: "SET_TILE_SOLID", id: mesh.selectedNodeId, tile: 0, value: true })).toBe(mesh);
  });

  it("is undoable, and a duplicate keeps the grid", () => {
    const { state, id } = withTileMap();
    const painted = run(state, { type: "PAINT_TILE", id, column: 0, row: 0, tile: 2 });
    expect(dataOf(run(painted, { type: "UNDO" }), id).tiles[0]).toBe(-1);
    const duplicated = run(painted, { type: "DUPLICATE_NODE", id });
    const copies = [...flat(duplicated.sceneRoot)].filter((node) => node.kind === "TileMap");
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(getTileMap(copy).tiles[0]).toBe(2);
  });
});

function* flat(node: import("@goodstuff/core").SceneNode): Generator<import("@goodstuff/core").SceneNode> {
  yield node;
  for (const child of node.children) yield* flat(child);
}
