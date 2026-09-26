import { createBlankSceneTree, createProjectSnapshot, findSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.mesh-colors.md: choosing a mesh's color in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withMesh(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "MeshInstance3D" });
  return { state, id: state.selectedNodeId! };
}
const colorOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.mesh!.color;

describe("a mesh's color", () => {
  it("is set, kept to the DS's 32 levels, undone, and cleared back to the default", () => {
    const { state, id } = withMesh();
    expect(colorOf(state, id)).toBeUndefined();
    const set = run(state, { type: "SET_MESH_COLOR", id, color: "#ff0000", at: 1 });
    expect(colorOf(set, id)).toBe("#ff0000");
    const odd = run(state, { type: "SET_MESH_COLOR", id, color: "#123456", at: 1 });
    expect(colorOf(odd, id)).toBe("#103152"); // 8-bit values snapped to 5-bit levels
    expect(colorOf(run(set, { type: "UNDO" }), id)).toBeUndefined();
    expect(colorOf(run(set, { type: "SET_MESH_COLOR", id, color: null, at: 2 }), id)).toBeUndefined();
  });

  it("ignores what isn't a color, what is already set, and a node without a mesh", () => {
    const { state, id } = withMesh();
    expect(run(state, { type: "SET_MESH_COLOR", id, color: "red", at: 1 })).toBe(state);
    expect(run(state, { type: "SET_MESH_COLOR", id, color: null, at: 1 })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_MESH_COLOR", id: other.selectedNodeId!, color: "#ffffff", at: 1 })).toBe(other);
  });

  it("makes dragging in a color picker one undo step", () => {
    const { state, id } = withMesh();
    const dragged = run(state, { type: "SET_MESH_COLOR", id, color: "#100000", at: 1000 }, { type: "SET_MESH_COLOR", id, color: "#900000", at: 1100 }, { type: "SET_MESH_COLOR", id, color: "#ff0000", at: 1200 });
    expect(colorOf(run(dragged, { type: "UNDO" }), id)).toBeUndefined();
  });

  it("is saved with the project", () => {
    const { state, id } = withMesh();
    const saved = savedProjectOf(run(state, { type: "SET_MESH_COLOR", id, color: "#00ff00", at: 1 }));
    expect(saved.scene.children.find((n) => n.id === id)!.mesh!.color).toBe("#00ff00");
  });
});
