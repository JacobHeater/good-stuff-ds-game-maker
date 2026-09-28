import { createBlankSceneTree, createProjectSnapshot, findSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.mesh-transparency.md: a mesh's opacity, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withMesh(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "MeshInstance3D" });
  return { state, id: state.selectedNodeId! };
}
const alphaOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.mesh!.alpha;

describe("a mesh's opacity", () => {
  it("is unset (fully opaque) by default, can be set to a fraction, and undone", () => {
    const { state, id } = withMesh();
    expect(alphaOf(state, id)).toBeUndefined();
    const half = run(state, { type: "SET_MESH_ALPHA", id, alpha: 0.5, at: 1 });
    expect(alphaOf(half, id)).toBe(0.5);
    const quarter = run(half, { type: "SET_MESH_ALPHA", id, alpha: 0.25, at: 5000 }); // past the merge window
    expect(alphaOf(quarter, id)).toBe(0.25);
    expect(alphaOf(run(quarter, { type: "UNDO" }), id)).toBe(0.5);
  });

  it("setting it back to 1 (fully opaque) clears the field rather than storing the default explicitly", () => {
    const { state, id } = withMesh();
    const half = run(state, { type: "SET_MESH_ALPHA", id, alpha: 0.5, at: 1 });
    expect(alphaOf(run(half, { type: "SET_MESH_ALPHA", id, alpha: 1, at: 2 }), id)).toBeUndefined();
  });

  it("clamps out-of-range values and ignores setting what it already is, and a node without a mesh", () => {
    const { state, id } = withMesh();
    expect(alphaOf(run(state, { type: "SET_MESH_ALPHA", id, alpha: 2, at: 1 }), id)).toBeUndefined(); // clamped to 1, which is the default
    expect(alphaOf(run(state, { type: "SET_MESH_ALPHA", id, alpha: -1, at: 1 }), id)).toBe(0);
    expect(run(state, { type: "SET_MESH_ALPHA", id, alpha: 1, at: 1 })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_MESH_ALPHA", id: other.selectedNodeId!, alpha: 0.5, at: 1 })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, id } = withMesh();
    const saved = savedProjectOf(run(state, { type: "SET_MESH_ALPHA", id, alpha: 0.5, at: 1 }));
    expect(saved.scene.children.find((n) => n.id === id)!.mesh!.alpha).toBe(0.5);
  });
});
