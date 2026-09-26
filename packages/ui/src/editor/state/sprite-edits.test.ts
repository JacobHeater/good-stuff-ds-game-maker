import { createBlankSceneTree, createProjectSnapshot, createSpriteFromRgba, findSceneNode, withUpdatedScene, type ImportedSprite } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(mode: "2D" | "3D" = "2D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
function image(id: string, name = id, width = 16, height = 16): ImportedSprite {
  const made = createSpriteFromRgba(new Uint8Array(width * height * 4).fill(200), width, height, { name });
  if (!made.ok) throw new Error("sprite didn't convert");
  return { id, ...made.sprite };
}

const withSprite = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "Sprite2D" });
  return { state, id: state.selectedNodeId };
};
const imageOf = (s: EditorState, id: string): string | undefined => findSceneNode(s.sceneRoot, id)!.spriteId;
const undo: Action = { type: "UNDO" };
const redo: Action = { type: "REDO" };

describe("importing and choosing sprite images", () => {
  it("imports an image into the project and onto the selected Sprite2D in one step", () => {
    const { state, id } = withSprite();
    const s = image("s1", "hero", 32, 32);
    const imported = run(state, { type: "IMPORT_SPRITE", nodeId: id, sprite: s, warnings: ["careful"] });
    expect(imported.project!.sprites).toEqual([s]);
    expect(imageOf(imported, id)).toBe("s1");
    expect(imported.outputLog.slice(-2)).toEqual(['Imported sprite image "hero" (32 x 32, 1024 bytes of sprite memory) onto "Sprite2D".', "Warning: careful"]);
    expect(hasUnsavedChanges(imported)).toBe(true);
  });

  it("with no sprite selected, adds a new Sprite2D in the middle of the screen, under the selected node", () => {
    const imported = run(openProject(), { type: "IMPORT_SPRITE", nodeId: null, sprite: image("s1", "hero"), warnings: [] });
    const node = findSceneNode(imported.sceneRoot, imported.selectedNodeId)!;
    expect(node).toMatchObject({ kind: "Sprite2D", name: "hero", spriteId: "s1", position: { x: 128, y: 96 } });
    expect(imported.sceneRoot.children).toHaveLength(1);
    expect(imported.project!.sprites).toHaveLength(1);
  });

  it("can be undone and redone, taking the image out of the project and back", () => {
    const { state, id } = withSprite();
    const imported = run(state, { type: "IMPORT_SPRITE", nodeId: id, sprite: image("s1"), warnings: [] });
    const undone = run(imported, undo);
    expect(undone.project!.sprites).toBeUndefined();
    expect(imageOf(undone, id)).toBeUndefined();
    const redone = run(undone, redo);
    expect(redone.project!.sprites).toHaveLength(1);
    expect(imageOf(redone, id)).toBe("s1");
  });

  it("chooses another imported image, or none", () => {
    const { state, id } = withSprite();
    const two = run(state, { type: "IMPORT_SPRITE", nodeId: id, sprite: image("a"), warnings: [] }, { type: "IMPORT_SPRITE", nodeId: id, sprite: image("b"), warnings: [] });
    expect(imageOf(two, id)).toBe("b");
    expect(imageOf(run(two, { type: "SET_SPRITE_IMAGE", id, spriteId: "a" }), id)).toBe("a");
    const cleared = run(two, { type: "SET_SPRITE_IMAGE", id, spriteId: null });
    expect(findSceneNode(cleared.sceneRoot, id)).not.toHaveProperty("spriteId");
  });

  it("refuses an image the project doesn't have, and a node that isn't a Sprite2D, without an edit", () => {
    const { state, id } = withSprite();
    expect(run(state, { type: "SET_SPRITE_IMAGE", id, spriteId: "nope" })).toBe(state);
    const label = run(openProject(), { type: "ADD_NODE", kind: "Label" });
    expect(run(label, { type: "SET_SPRITE_IMAGE", id: label.selectedNodeId, spriteId: null })).toBe(label);
  });

  it("choosing the image a sprite already has is not an edit", () => {
    const { state, id } = withSprite();
    const imported = run(state, { type: "IMPORT_SPRITE", nodeId: id, sprite: image("s1"), warnings: [] });
    expect(run(imported, { type: "SET_SPRITE_IMAGE", id, spriteId: "s1" })).toBe(imported);
  });

  it("drops an image when the last sprite using it is deleted (on save)", () => {
    const { state, id } = withSprite();
    const imported = run(state, { type: "IMPORT_SPRITE", nodeId: id, sprite: image("s1"), warnings: [] });
    const deleted = run(imported, { type: "DELETE_NODE", id });
    expect(withUpdatedScene(deleted.project!, deleted.sceneRoot)).not.toHaveProperty("sprites");
  });

  it("works in a 3D project too (its 2D screen holds Sprite2D nodes)", () => {
    const imported = run(openProject("3D"), { type: "IMPORT_SPRITE", nodeId: null, sprite: image("s1", "hud"), warnings: [] });
    expect(findSceneNode(imported.sceneRoot, imported.selectedNodeId)).toMatchObject({ kind: "Sprite2D", spriteId: "s1" });
  });
});

describe("choosing a node's screen in a 2D project", () => {
  it("moves a node to the other screen, as one undoable edit", () => {
    const { state, id } = withSprite();
    expect(findSceneNode(state.sceneRoot, id)!.screen).toBe("top");
    const moved = run(state, { type: "SET_NODE_SCREEN", id, screen: "bottom" });
    expect(findSceneNode(moved.sceneRoot, id)!.screen).toBe("bottom");
    expect(hasUnsavedChanges(moved)).toBe(true);
    expect(findSceneNode(run(moved, undo).sceneRoot, id)!.screen).toBe("top");
  });

  it("is not an edit when the node is already there, and never moves the scene root", () => {
    const { state, id } = withSprite();
    expect(run(state, { type: "SET_NODE_SCREEN", id, screen: "top" })).toBe(state);
    expect(run(state, { type: "SET_NODE_SCREEN", id: state.sceneRoot.id, screen: "bottom" })).toBe(state);
  });

  it("does nothing in a 3D project, where the screens follow from what draws each node", () => {
    const state = run(openProject("3D"), { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(state, { type: "SET_NODE_SCREEN", id: state.selectedNodeId, screen: "bottom" })).toBe(state);
  });
});

describe("a sprite rotation and scale", () => {
  const transformOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.transform2D;

  it("are set from the Inspector, keeping each other, as an undoable edit", () => {
    const { state, id } = withSprite();
    const turned = run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { rotation: 45 }, at: 1 }, { type: "SET_SPRITE_TRANSFORM", id, change: { scaleX: -2 }, at: 5000 });
    expect(transformOf(turned, id)).toEqual({ rotation: 45, scale: { x: -2, y: 1 } });
    expect(hasUnsavedChanges(turned)).toBe(true);
    expect(transformOf(run(turned, undo), id)).toEqual({ rotation: 45, scale: { x: 1, y: 1 } });
  });

  it("limit the scale to what the DS can do, and a value it already has is not an edit", () => {
    const { state, id } = withSprite();
    expect(transformOf(run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { scaleY: 500 }, at: 1 }), id)!.scale).toEqual({ x: 1, y: 8 });
    expect(run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { rotation: 0, scaleX: 1 }, at: 1 })).toBe(state);
    expect(run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { rotation: NaN }, at: 1 })).toBe(state);
  });

  it("ignore a node that is not a Sprite2D, and a copy keeps them", () => {
    const label = run(openProject(), { type: "ADD_NODE", kind: "Label" });
    expect(run(label, { type: "SET_SPRITE_TRANSFORM", id: label.selectedNodeId, change: { rotation: 10 }, at: 1 })).toBe(label);
    const { state, id } = withSprite();
    const copied = run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { rotation: 30 }, at: 1 }, { type: "DUPLICATE_NODE", id });
    expect(copied.sceneRoot.children.map((c) => c.transform2D?.rotation)).toEqual([30, 30]);
  });
});
