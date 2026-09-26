import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getLabel, MAX_LABEL_CHARS } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.labels-and-text.md: editing a Label in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withLabel(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "Label" });
  return { state, id: state.selectedNodeId! };
}
const labelOf = (s: EditorState, id: string) => getLabel(findSceneNode(s.sceneRoot, id)!);

describe("editing a label", () => {
  it("starts as white text that says Label", () => {
    const { state, id } = withLabel();
    expect(labelOf(state, id)).toEqual({ text: "Label", color: 7 });
  });

  it("changes the text and the color, each an edit that can be undone", () => {
    const { state, id } = withLabel();
    const typed = run(state, { type: "SET_LABEL", id, change: { text: "Score: {}" }, at: 1000 });
    expect(labelOf(typed, id).text).toBe("Score: {}");
    const colored = run(typed, { type: "SET_LABEL", id, change: { color: 3 }, at: 2000 });
    expect(labelOf(colored, id)).toEqual({ text: "Score: {}", color: 3 });
    expect(hasUnsavedChanges(colored)).toBe(true);
    const undone = run(colored, { type: "UNDO" });
    expect(labelOf(undone, id).color).toBe(7);
    expect(labelOf(undone, id).text).toBe("Score: {}");
  });

  it("makes typing one undo step per pause", () => {
    const { state, id } = withLabel();
    const typed = run(state, { type: "SET_LABEL", id, change: { text: "S" }, at: 1000 }, { type: "SET_LABEL", id, change: { text: "Sc" }, at: 1100 }, { type: "SET_LABEL", id, change: { text: "Sco" }, at: 1200 });
    expect(labelOf(run(typed, { type: "UNDO" }), id).text).toBe("Label");
  });

  it("keeps the color to the eight there are and the text to what a label holds", () => {
    const { state, id } = withLabel();
    expect(labelOf(run(state, { type: "SET_LABEL", id, change: { color: 99 }, at: 1 }), id).color).toBe(7);
    expect(labelOf(run(state, { type: "SET_LABEL", id, change: { text: "x".repeat(500) }, at: 1 }), id).text).toHaveLength(MAX_LABEL_CHARS);
  });

  it("isn't an edit to set what is already there, and does nothing to another kind of node", () => {
    const { state, id } = withLabel();
    expect(run(state, { type: "SET_LABEL", id, change: { text: "Label", color: 7 }, at: 1 })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node2D" });
    expect(run(other, { type: "SET_LABEL", id: other.selectedNodeId!, change: { text: "x" }, at: 1 })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, id } = withLabel();
    const saved = savedProjectOf(run(state, { type: "SET_LABEL", id, change: { text: "HP {}", color: 1 }, at: 1 }));
    expect(saved.scene.children.find((n) => n.id === id)!.label).toEqual({ text: "HP {}", color: 1 });
  });
});
