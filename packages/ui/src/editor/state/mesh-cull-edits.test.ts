import { createBlankSceneTree, createProjectSnapshot, findSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.mesh-face-culling.md: choosing which side(s) of a mesh's triangles are drawn, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withMesh(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "MeshInstance3D" });
  return { state, id: state.selectedNodeId! };
}
const cullOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.mesh!.cull;

describe("a mesh's face culling", () => {
  it("is unset (both sides) by default, can be set to back or front, and undone", () => {
    const { state, id } = withMesh();
    expect(cullOf(state, id)).toBeUndefined();
    const backed = run(state, { type: "SET_MESH_CULL", id, cull: "back" });
    expect(cullOf(backed, id)).toBe("back");
    const fronted = run(backed, { type: "SET_MESH_CULL", id, cull: "front" });
    expect(cullOf(fronted, id)).toBe("front");
    expect(cullOf(run(fronted, { type: "UNDO" }), id)).toBe("back");
  });

  it("setting it back to none clears the field rather than storing the default explicitly", () => {
    const { state, id } = withMesh();
    const backed = run(state, { type: "SET_MESH_CULL", id, cull: "back" });
    expect(cullOf(run(backed, { type: "SET_MESH_CULL", id, cull: "none" }), id)).toBeUndefined();
  });

  it("ignores setting what it already is, and a node without a mesh", () => {
    const { state, id } = withMesh();
    expect(run(state, { type: "SET_MESH_CULL", id, cull: "none" })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_MESH_CULL", id: other.selectedNodeId!, cull: "back" })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, id } = withMesh();
    const saved = savedProjectOf(run(state, { type: "SET_MESH_CULL", id, cull: "back" }));
    expect(saved.scene.children.find((n) => n.id === id)!.mesh!.cull).toBe("back");
  });
});
