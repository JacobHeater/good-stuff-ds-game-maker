import { createBlankSceneTree, createProjectSnapshot, findSceneNode, flattenSceneTree, type ScreenId } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, screenRolesOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.choose-2d-screen-in-3d-project.md (the state behind the toolbar's 2D screen choice and the Add Node menu) */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function open(twoD?: ScreenId): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D", twoD) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const add = (state: EditorState, kind: Parameters<typeof editorReducer>[1] extends infer A ? (A extends { type: "ADD_NODE"; kind: infer K } ? K : never) : never): EditorState =>
  run(state, { type: "ADD_NODE", kind });
const nodeNamed = (state: EditorState, name: string) => flattenSceneTree(state.sceneRoot).find((n) => n.name === name)!;

describe("the 2D screen of a 3D project", () => {
  it("opens with 3D on top and 2D on the bottom by default, looking at the 3D screen", () => {
    const state = open();
    expect(screenRolesOf(state)).toEqual({ threeD: "top", twoD: "bottom" });
    expect(state.screenFilter).toBe("top");
  });

  it("opens with 3D on the bottom when the 2D screen is the top one, looking at the 3D screen", () => {
    const state = open("top");
    expect(screenRolesOf(state)).toEqual({ threeD: "bottom", twoD: "top" });
    expect(state.screenFilter).toBe("bottom");
  });

  it("has no roles in a 2D project", () => {
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
    expect(screenRolesOf(editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project }))).toBeNull();
  });

  it("puts new nodes on the screen of the engine that draws them", () => {
    let state = open(); // 3D on top, 2D on bottom
    state = add(state, "MeshInstance3D");
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id });
    state = add(state, "Label");
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id });
    state = add(state, "AudioStreamPlayer");
    expect(nodeNamed(state, "MeshInstance3D").screen).toBe("top");
    expect(nodeNamed(state, "Label").screen).toBe("bottom");
    expect(nodeNamed(state, "AudioStreamPlayer").screen).toBe("top");
    const flipped = add(run(open("top"), { type: "ADD_NODE", kind: "Sprite2D" }), "MeshInstance3D");
    expect(nodeNamed(flipped, "Sprite2D").screen).toBe("top");
    expect(nodeNamed(flipped, "MeshInstance3D").screen).toBe("bottom");
  });

  it("puts a 2D node under the root, not under a selected 3D node, and a 3D node not under a 2D one", () => {
    let state = add(open(), "MeshInstance3D"); // the new mesh is selected
    state = add(state, "Label");
    expect(state.sceneRoot.children.map((n) => n.name)).toEqual(["MeshInstance3D", "Label"]);
    state = add(state, "MeshInstance3D"); // the Label is selected now
    expect(state.sceneRoot.children.map((n) => n.name)).toEqual(["MeshInstance3D", "Label", "MeshInstance3D2"]);
    // A 2D node under a 2D node is fine, and a sound player goes under whatever is selected.
    state = run(state, { type: "SELECT_NODE", id: nodeNamed(state, "Label").id });
    state = add(state, "Sprite2D");
    expect(findSceneNode(state.sceneRoot, nodeNamed(state, "Label").id)!.children.map((n) => n.name)).toEqual(["Sprite2D"]);
    state = run(state, { type: "SELECT_NODE", id: nodeNamed(state, "Label").id });
    state = add(state, "AudioStreamPlayer");
    expect(findSceneNode(state.sceneRoot, nodeNamed(state, "Label").id)!.children.map((n) => n.name)).toEqual(["Sprite2D", "AudioStreamPlayer"]);
  });

  it("swaps the screens as one undoable step: every node moves, the view follows the 3D screen, and it counts as an unsaved change", () => {
    let state = add(open(), "MeshInstance3D");
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id });
    state = add(state, "Label");
    const before = state.sceneRoot;
    const swapped = run(state, { type: "SET_TWO_D_SCREEN", screen: "top" });
    expect(screenRolesOf(swapped)).toEqual({ threeD: "bottom", twoD: "top" });
    expect(swapped.sceneRoot.screen).toBe("bottom");
    expect(nodeNamed(swapped, "MeshInstance3D").screen).toBe("bottom");
    expect(nodeNamed(swapped, "Label").screen).toBe("top");
    expect(swapped.screenFilter).toBe("bottom");
    expect(hasUnsavedChanges(swapped)).toBe(true);
    const undone = run(swapped, { type: "UNDO" });
    expect(undone.sceneRoot).toBe(before);
    expect(run(undone, { type: "REDO" }).sceneRoot).toBe(swapped.sceneRoot);
  });

  it("does nothing when the 2D screen is already there, or in a 2D project", () => {
    const state = open();
    expect(run(state, { type: "SET_TWO_D_SCREEN", screen: "bottom" })).toBe(state);
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
    const twoD = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
    expect(run(twoD, { type: "SET_TWO_D_SCREEN", screen: "bottom" })).toBe(twoD);
  });

  it("swapping there and back puts every node where it was", () => {
    const state = open();
    const there = run(state, { type: "SET_TWO_D_SCREEN", screen: "top" }, { type: "SET_TWO_D_SCREEN", screen: "bottom" });
    expect(screenRolesOf(there)).toEqual(screenRolesOf(state));
    expect(there.sceneRoot.screen).toBe("top");
  });
});
