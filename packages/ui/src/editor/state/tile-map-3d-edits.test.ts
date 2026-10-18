import { createBlankSceneTree, createProjectSnapshot, DEFAULT_TILE_MAP_3D, findSceneNode, getTileMap3D, withUpdatedScene, type TileMap3DPaletteEntry } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, DEFAULT_TILE_MAP_3D_BRUSH, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const withGrid = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "TileMap3D" });
  return { state, id: state.selectedNodeId };
};
const gridOf = (s: EditorState, id: string) => getTileMap3D(findSceneNode(s.sceneRoot, id)!);
const stonePalette: TileMap3DPaletteEntry[] = [{ id: "stone", importedMeshId: "stone-mesh" }];

describe("a new TileMap3D", () => {
  it("starts with an empty palette and no cells, nothing saved for it", () => {
    const { state, id } = withGrid();
    expect(gridOf(state, id)).toEqual(DEFAULT_TILE_MAP_3D);
    expect(findSceneNode(state.sceneRoot, id)!.tileMap3D).toBeUndefined();
  });
});

describe("TileMap3D palette edits", () => {
  it("replaces the whole palette, and undoes/redoes it", () => {
    const { state, id } = withGrid();
    const added = run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: stonePalette });
    expect(gridOf(added, id).palette).toEqual(stonePalette);
    expect(hasUnsavedChanges(added)).toBe(true);
    expect(added.history.past.at(-1)!.label).toBe("Change the palette of TileMap3D");
    const undone = run(added, { type: "UNDO" });
    expect(gridOf(undone, id).palette).toEqual([]);
    expect(gridOf(run(undone, { type: "REDO" }), id).palette).toEqual(stonePalette);
  });

  it("does nothing when the palette is the same array (by reference)", () => {
    const { state, id } = withGrid();
    expect(run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: gridOf(state, id).palette })).toBe(state);
  });

  it("does nothing for a node that isn't a TileMap3D", () => {
    const s = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(s, { type: "SET_TILE_MAP_3D_PALETTE", id: s.selectedNodeId, palette: stonePalette })).toBe(s);
    expect(run(s, { type: "SET_TILE_MAP_3D_PALETTE", id: "nope", palette: stonePalette })).toBe(s);
  });
});

describe("painting and erasing a TileMap3D's cells", () => {
  it("paints a cell, undoes and redoes it", () => {
    const { state, id } = withGrid();
    const withPalette = run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: stonePalette });
    const painted = run(withPalette, { type: "PAINT_TILE_3D", id, x: 1, y: 2, z: 3, paletteId: "stone", rotationY: 1 });
    expect(gridOf(painted, id).cells).toEqual({ "1,2,3": { paletteId: "stone", rotationY: 1 } });
    expect(painted.history.past.at(-1)!.label).toBe("Paint a tile on TileMap3D");
    const undone = run(painted, { type: "UNDO" });
    expect(gridOf(undone, id).cells).toEqual({});
    expect(gridOf(run(undone, { type: "REDO" }), id).cells).toEqual({ "1,2,3": { paletteId: "stone", rotationY: 1 } });
  });

  it("repainting the same cell with the same palette entry and rotation is not a new edit", () => {
    const { state, id } = withGrid();
    const withPalette = run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: stonePalette });
    const painted = run(withPalette, { type: "PAINT_TILE_3D", id, x: 0, y: 0, z: 0, paletteId: "stone", rotationY: 0 });
    expect(run(painted, { type: "PAINT_TILE_3D", id, x: 0, y: 0, z: 0, paletteId: "stone", rotationY: 0 })).toBe(painted);
  });

  it("erases a painted cell, and does nothing to one that's already empty", () => {
    const { state, id } = withGrid();
    const withPalette = run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: stonePalette });
    const painted = run(withPalette, { type: "PAINT_TILE_3D", id, x: 5, y: 0, z: 0, paletteId: "stone", rotationY: 0 });
    const erased = run(painted, { type: "ERASE_TILE_3D", id, x: 5, y: 0, z: 0 });
    expect(gridOf(erased, id).cells).toEqual({});
    expect(erased.history.past.at(-1)!.label).toBe("Erase a tile of TileMap3D");
    expect(run(erased, { type: "ERASE_TILE_3D", id, x: 5, y: 0, z: 0 })).toBe(erased);
    expect(run(erased, { type: "ERASE_TILE_3D", id, x: 9, y: 9, z: 9 })).toBe(erased);
  });

  it("does nothing for a node that isn't a TileMap3D", () => {
    const s = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(s, { type: "PAINT_TILE_3D", id: s.selectedNodeId, x: 0, y: 0, z: 0, paletteId: "stone", rotationY: 0 })).toBe(s);
    expect(run(s, { type: "ERASE_TILE_3D", id: s.selectedNodeId, x: 0, y: 0, z: 0 })).toBe(s);
  });

  it("is saved with the node", () => {
    const { state, id } = withGrid();
    const withPalette = run(state, { type: "SET_TILE_MAP_3D_PALETTE", id, palette: stonePalette });
    const painted = run(withPalette, { type: "PAINT_TILE_3D", id, x: 1, y: 0, z: 0, paletteId: "stone", rotationY: 2 });
    const saved = findSceneNode(withUpdatedScene(painted.project!, painted.sceneRoot).scene, id)!.tileMap3D;
    expect(saved).toEqual({ palette: stonePalette, cells: { "1,0,0": { paletteId: "stone", rotationY: 2 } } });
  });
});

describe("the Paint tool's own brush", () => {
  it("starts at the default (no palette entry picked, no rotation) and is not an edit", () => {
    const state = openProject();
    expect(state.tileMap3DBrush).toEqual(DEFAULT_TILE_MAP_3D_BRUSH);
    const changed = run(state, { type: "SET_TILE_MAP_3D_BRUSH", change: { paletteId: "stone" } });
    expect(changed.tileMap3DBrush).toEqual({ paletteId: "stone", rotationY: 0 });
    expect(hasUnsavedChanges(changed)).toBe(false);
    expect(changed.history.past).toEqual(state.history.past); // no undo step
  });

  it("changes one field at a time, leaving the other alone", () => {
    const state = openProject();
    const withPalette = run(state, { type: "SET_TILE_MAP_3D_BRUSH", change: { paletteId: "stone" } });
    const rotated = run(withPalette, { type: "SET_TILE_MAP_3D_BRUSH", change: { rotationY: 2 } });
    expect(rotated.tileMap3DBrush).toEqual({ paletteId: "stone", rotationY: 2 });
  });
});
