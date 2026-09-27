import { createBlankSceneTree, createProjectSnapshot, findSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.unlit-meshes.md: toggling whether a mesh reacts to the scene's lights, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withMesh(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "MeshInstance3D" });
  return { state, id: state.selectedNodeId! };
}
const unlitOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.mesh!.unlit;

describe("a mesh's unlit toggle", () => {
  it("is off by default, can be turned on, undone, and turned back off", () => {
    const { state, id } = withMesh();
    expect(unlitOf(state, id)).toBeUndefined();
    const on = run(state, { type: "SET_MESH_UNLIT", id, unlit: true });
    expect(unlitOf(on, id)).toBe(true);
    expect(unlitOf(run(on, { type: "UNDO" }), id)).toBeUndefined();
    expect(unlitOf(run(on, { type: "SET_MESH_UNLIT", id, unlit: false }), id)).toBeUndefined();
  });

  it("ignores setting what it already is, and a node without a mesh", () => {
    const { state, id } = withMesh();
    expect(run(state, { type: "SET_MESH_UNLIT", id, unlit: false })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_MESH_UNLIT", id: other.selectedNodeId!, unlit: true })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, id } = withMesh();
    const saved = savedProjectOf(run(state, { type: "SET_MESH_UNLIT", id, unlit: true }));
    expect(saved.scene.children.find((n) => n.id === id)!.mesh!.unlit).toBe(true);
  });
});
