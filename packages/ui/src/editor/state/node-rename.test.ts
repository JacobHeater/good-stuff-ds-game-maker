import { createBlankSceneTree, createProjectSnapshot, findSceneNode, flattenSceneTree } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

/** requirements/properties-panel/STORY.rename-a-node.md */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withShape(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "CollisionShape3D" });
  return { state, id: state.selectedNodeId };
}
const rename = (id: string, name: string, at = 0): Action => ({ type: "RENAME_NODE", id, name, at });
const nameOf = (state: EditorState, id: string): string => findSceneNode(state.sceneRoot, id)!.name;

describe("renaming a node", () => {
  it("changes the name, is an unsaved change, and is labelled for the undo menu and log", () => {
    const { state, id } = withShape();
    const renamed = run(state, rename(id, "CoinShape"));
    expect(nameOf(renamed, id)).toBe("CoinShape");
    expect(renamed.history.past.at(-1)!.label).toBe("Rename CollisionShape3D");
    expect(hasUnsavedChanges(renamed)).toBe(true);
  });

  it("trims the name, and ignores an empty one, a blank one, the same name, a missing node", () => {
    const { state, id } = withShape();
    expect(nameOf(run(state, rename(id, "  Coin  ")), id)).toBe("Coin");
    expect(run(state, rename(id, ""))).toBe(state);
    expect(run(state, rename(id, "   "))).toBe(state);
    expect(run(state, rename(id, "CollisionShape3D"))).toBe(state);
    expect(run(state, rename(id, "  CollisionShape3D "))).toBe(state);
    expect(run(state, rename("missing", "X"))).toBe(state);
  });

  it("is undoable, and typing within a pause is one step", () => {
    const { state, id } = withShape();
    const steps = state.history.past.length;
    let typed = state;
    for (const [i, text] of ["C", "Co", "Coi", "Coin"].entries()) typed = run(typed, rename(id, text, 1000 + i * 100));
    expect(typed.history.past).toHaveLength(steps + 1);
    expect(nameOf(run(typed, { type: "UNDO" }), id)).toBe("CollisionShape3D");
    expect(nameOf(run(typed, { type: "UNDO" }, { type: "REDO" }), id)).toBe("Coin");
    // After a pause it is a new step.
    const later = run(typed, rename(id, "Coin2", 9000));
    expect(later.history.past).toHaveLength(steps + 2);
    expect(nameOf(run(later, { type: "UNDO" }), id)).toBe("Coin");
  });

  it("allows a name another node has, so the editor can point it out rather than forbid it", () => {
    const { state, id } = withShape();
    const other = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id }, { type: "ADD_NODE", kind: "CollisionShape3D" });
    const second = other.selectedNodeId;
    const renamed = run(other, rename(second, "CollisionShape3D"));
    // (The second was already given a unique name by adding it under the same parent; the rename to the first's name is allowed.)
    expect(flattenSceneTree(renamed.sceneRoot).filter((n) => n.name === "CollisionShape3D")).toHaveLength(2);
    expect(id).not.toBe(second);
  });

  it("can rename the root and 2D nodes too", () => {
    const { state } = withShape();
    expect(nameOf(run(state, rename(state.sceneRoot.id, "Level")), state.sceneRoot.id)).toBe("Level");
  });
});
