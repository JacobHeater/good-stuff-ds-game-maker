import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getLightIntensity, withUpdatedScene } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, NEW_DIRECTIONAL_LIGHT_ROTATION, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const withLight = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "DirectionalLight3D" });
  return { state, id: state.selectedNodeId };
};
const set = (id: string, intensity: number, at: number): Action => ({ type: "SET_LIGHT_INTENSITY", id, intensity, at });
const intensityOf = (s: EditorState, id: string): number => getLightIntensity(findSceneNode(s.sceneRoot, id)!);

describe("a new directional light", () => {
  it("starts angled down and to the side, not along -Z where it would light very little", () => {
    const { state, id } = withLight();
    expect(findSceneNode(state.sceneRoot, id)!.transform3D!.rotation).toEqual(NEW_DIRECTIONAL_LIGHT_ROTATION);
    expect(NEW_DIRECTIONAL_LIGHT_ROTATION).toEqual({ x: -45, y: -30, z: 0 });
  });

  it("gives each light its own rotation object, so editing one can't change another", () => {
    const first = withLight();
    const both = run(first.state, { type: "SELECT_NODE", id: first.state.sceneRoot.id }, { type: "ADD_NODE", kind: "DirectionalLight3D" });
    const a = findSceneNode(both.sceneRoot, first.id)!.transform3D!.rotation;
    const b = findSceneNode(both.sceneRoot, both.selectedNodeId)!.transform3D!.rotation;
    expect(a).not.toBe(b);
  });

  it("only directional lights get it: other nodes still start at rotation 0", () => {
    const s = run(openProject(), { type: "ADD_NODE", kind: "Camera3D" });
    expect(findSceneNode(s.sceneRoot, s.selectedNodeId)!.transform3D!.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("starts at full intensity with nothing saved for it", () => {
    const { state, id } = withLight();
    expect(intensityOf(state, id)).toBe(1);
    expect(findSceneNode(state.sceneRoot, id)!.light).toBeUndefined();
  });
});

describe("light intensity edits", () => {
  it("sets the intensity, and undoes and redoes it", () => {
    const { state, id } = withLight();
    const dimmed = run(state, set(id, 0.4, 1000));
    expect(intensityOf(dimmed, id)).toBe(0.4);
    expect(hasUnsavedChanges(dimmed)).toBe(true);
    const undone = run(dimmed, { type: "UNDO" });
    expect(intensityOf(undone, id)).toBe(1);
    expect(undone.sceneRoot).toBe(state.sceneRoot);
    expect(intensityOf(run(undone, { type: "REDO" }), id)).toBe(0.4);
    expect(dimmed.history.past.at(-1)!.label).toBe("Change intensity of DirectionalLight3D");
  });

  it("makes a whole slider drag one undo step, and two drags two", () => {
    const { state, id } = withLight();
    let s = run(state, set(id, 0.9, 1000), set(id, 0.7, 1030), set(id, 0.5, 1060), set(id, 0.3, 1090));
    expect(s.history.past).toHaveLength(2); // the add, and one merged drag
    expect(intensityOf(run(s, { type: "UNDO" }), id)).toBe(1);
    s = run(s, { type: "END_EDIT_GESTURE" }, set(id, 0.1, 1100));
    expect(s.history.past).toHaveLength(3);
    expect(intensityOf(run(s, { type: "UNDO" }), id)).toBe(0.3);
  });

  it("clamps to 0..1", () => {
    const { state, id } = withLight();
    expect(intensityOf(run(state, set(id, 5, 0)), id)).toBe(1); // 100% is what it already was: nothing changes
    expect(run(state, set(id, 5, 0))).toBe(state);
    expect(intensityOf(run(state, set(id, -2, 0)), id)).toBe(0);
  });

  it("does nothing when the value is the one it already has, including 100% on a light that never had one saved", () => {
    const { state, id } = withLight();
    expect(run(state, set(id, 1, 0))).toBe(state);
    const dimmed = run(state, set(id, 0.5, 0));
    expect(run(dimmed, set(id, 0.5, 5000))).toBe(dimmed);
  });

  it("does nothing for a node that isn't a directional light", () => {
    const s = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(s, set(s.selectedNodeId, 0.2, 0))).toBe(s);
    expect(run(s, set("nope", 0.2, 0))).toBe(s);
    const omni = run(openProject(), { type: "ADD_NODE", kind: "OmniLight3D" });
    expect(run(omni, set(omni.selectedNodeId, 0.2, 0))).toBe(omni);
  });

  it("is saved with the node, and a light left at 100% that once was changed keeps a value of 1", () => {
    const { state, id } = withLight();
    const back = run(state, set(id, 0.6, 0), { type: "END_EDIT_GESTURE" }, set(id, 1, 5000));
    expect(findSceneNode(withUpdatedScene(back.project!, back.sceneRoot).scene, id)!.light).toEqual({ intensity: 1 });
    expect(intensityOf(back, id)).toBe(1);
  });
});
