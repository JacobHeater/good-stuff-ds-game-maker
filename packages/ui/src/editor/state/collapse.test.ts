import { createBlankSceneTree, createProjectSnapshot, createSceneNode, findSceneNode, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { ancestorIds, createInitialState, editorReducer, hasUnsavedChanges, nearestVisibleId, selectedNodeIdsOf, visibleNodeIds, type Action, type EditorState } from "./editor-store";

/** requirements/node-list/STORY.collapse-nodes-in-the-tree.md. Tree: Main > [A > [A1 > [A1a, A1b], A2, A3], B, C > [C1], D] */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
const n = (name: string, children: SceneNode[] = []): SceneNode => createSceneNode({ name, kind: "Node2D", children });

function open(): { state: EditorState; by: Record<string, SceneNode> } {
  const A1a = n("A1a");
  const A1b = n("A1b");
  const A1 = n("A1", [A1a, A1b]);
  const A2 = n("A2");
  const A3 = n("A3");
  const A = n("A", [A1, A2, A3]);
  const B = n("B");
  const C1 = n("C1");
  const C = n("C", [C1]);
  const D = n("D");
  const scene = { ...createBlankSceneTree("2D"), children: [A, B, C, D] };
  const state = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: createProjectSnapshot({ name: "P", mode: "2D", scene }) });
  return { state, by: { Main: scene, A, A1, A1a, A1b, A2, A3, B, C, C1, D } };
}
const fold = (id: string): Action => ({ type: "TOGGLE_COLLAPSED", id });
const click = (id: string): Action => ({ type: "SELECT_NODE", id });
const ctrl = (id: string): Action => ({ type: "SELECT_NODE_MODIFIED", id, mode: "toggle" });
const shift = (id: string): Action => ({ type: "SELECT_NODE_MODIFIED", id, mode: "range" });
const shown = (s: EditorState): string[] => visibleNodeIds(s.sceneRoot, s.collapsedNodeIds).map((id) => findSceneNode(s.sceneRoot, id)!.name);
const names = (s: EditorState): string[] => selectedNodeIdsOf(s).map((id) => findSceneNode(s.sceneRoot, id)!.name).sort();

describe("folding nodes in the tree", () => {
  it("folds a node's children away and unfolds them again", () => {
    const { state, by } = open();
    expect(shown(state)).toEqual(["Main", "A", "A1", "A1a", "A1b", "A2", "A3", "B", "C", "C1", "D"]);
    const folded = run(state, fold(by.A.id));
    expect(shown(folded)).toEqual(["Main", "A", "B", "C", "C1", "D"]);
    expect(shown(run(folded, fold(by.A.id)))).toEqual(shown(state));
  });

  it("is not an edit: nothing unsaved, no undo step, and the scene tree itself is the same object", () => {
    const { state, by } = open();
    const folded = run(state, fold(by.A.id), fold(by.C.id));
    expect(folded.sceneRoot).toBe(state.sceneRoot);
    expect(hasUnsavedChanges(folded)).toBe(false);
    expect(folded.history).toBe(state.history);
    expect(run(folded, { type: "UNDO" })).toBe(folded); // nothing to undo
  });

  it("folding a node with no children does nothing", () => {
    const { state, by } = open();
    expect(run(state, fold(by.B.id))).toBe(state);
  });

  it("an inner fold stays when the outer one is folded and unfolded: each keeps its own state", () => {
    const { state, by } = open();
    const s = run(state, fold(by.A1.id), fold(by.A.id));
    expect(shown(s)).toEqual(["Main", "A", "B", "C", "C1", "D"]);
    expect(shown(run(s, fold(by.A.id)))).toEqual(["Main", "A", "A1", "A2", "A3", "B", "C", "C1", "D"]);
  });

  it("folding takes the selected nodes inside it out of the selection; if the primary was one, the folded node is selected", () => {
    const { state, by } = open();
    const s = run(state, click(by.A1a.id), ctrl(by.C1.id), ctrl(by.A2.id), fold(by.A.id));
    expect(names(s)).toEqual(["A", "C1"]);
    expect(s.selectedNodeId).toBe(by.A.id);
    const inner = run(state, click(by.C1.id), ctrl(by.A2.id), ctrl(by.B.id), fold(by.A.id));
    expect(names(inner)).toEqual(["B", "C1"]);
    expect(inner.selectedNodeId).toBe(by.B.id);
  });

  it("a Shift+click range runs over the rows that are shown", () => {
    const { state, by } = open();
    const s = run(state, fold(by.A.id), click(by.A.id), shift(by.C.id));
    expect(names(s)).toEqual(["A", "B", "C"]); // not A's children
    // An anchor that got folded away counts as the row that stands for it.
    const hiddenAnchor = run(state, click(by.A1a.id), fold(by.A.id), shift(by.B.id));
    expect(names(hiddenAnchor)).toEqual(["A", "B"]);
  });

  it("selecting a node inside a folded one from elsewhere unfolds the way to it, and only that way", () => {
    const { state, by } = open();
    const s = run(state, fold(by.A.id), fold(by.A1.id), fold(by.C.id));
    const revealed = run(s, click(by.A1a.id));
    expect(revealed.collapsedNodeIds).toEqual([by.C.id]);
    expect(shown(revealed)).toContain("A1a");
    // A node added under a folded parent is shown.
    const added = run(run(state, fold(by.C.id)), click(by.C.id), { type: "ADD_NODE", kind: "Node2D" });
    expect(added.collapsedNodeIds).toEqual([]);
  });

  it("dropping nodes into a folded node opens it", () => {
    const { state, by } = open();
    const s = run(state, fold(by.C.id), { type: "MOVE_NODES", ids: [by.B.id], targetId: by.C.id, position: "inside" });
    expect(s.collapsedNodeIds).toEqual([]);
    const next = run(state, fold(by.C.id), { type: "MOVE_NODES", ids: [by.B.id], targetId: by.D.id, position: "before" });
    expect(next.collapsedNodeIds).toEqual([by.C.id]);
  });

  it("collapse all folds every node that has children except the scene root; expand all opens them all", () => {
    const { state, by } = open();
    const all = run(state, { type: "COLLAPSE_ALL" });
    expect([...all.collapsedNodeIds].sort()).toEqual([by.A.id, by.A1.id, by.C.id].sort());
    expect(shown(all)).toEqual(["Main", "A", "B", "C", "D"]);
    expect(shown(run(all, { type: "EXPAND_ALL" }))).toEqual(shown(state));
    expect(run(state, { type: "EXPAND_ALL" })).toBe(state);
  });

  it("collapse all brings a selection that got hidden up to the folded node that stands for it", () => {
    const { state, by } = open();
    const s = run(state, click(by.A1a.id), ctrl(by.C1.id), ctrl(by.B.id), { type: "COLLAPSE_ALL" });
    expect(names(s)).toEqual(["A", "B", "C"]);
    expect(s.selectedNodeId).toBe(by.B.id);
  });

  it("forgets folded nodes that were deleted, and a newly opened project starts unfolded", () => {
    const { state, by } = open();
    const s = run(state, fold(by.C.id), { type: "DELETE_NODE", id: by.C.id });
    expect(s.collapsedNodeIds).toEqual([]);
    const folded = run(state, fold(by.C.id));
    const reopened = editorReducer(folded, { type: "PROJECT_OPENED", filePath: "q.gsds", project: createProjectSnapshot({ name: "Q", mode: "2D", scene: createBlankSceneTree("2D") }) });
    expect(reopened.collapsedNodeIds).toEqual([]);
  });
});

describe("tree helpers", () => {
  it("visibleNodeIds, ancestorIds and nearestVisibleId", () => {
    const { state, by } = open();
    expect(ancestorIds(state.sceneRoot, by.A1a.id)).toEqual([by.Main.id, by.A.id, by.A1.id]);
    expect(ancestorIds(state.sceneRoot, by.Main.id)).toEqual([]);
    expect(ancestorIds(state.sceneRoot, "nope")).toEqual([]);
    expect(nearestVisibleId(state.sceneRoot, [], by.A1a.id)).toBe(by.A1a.id);
    expect(nearestVisibleId(state.sceneRoot, [by.A1.id], by.A1a.id)).toBe(by.A1.id);
    expect(nearestVisibleId(state.sceneRoot, [by.A1.id, by.A.id], by.A1a.id)).toBe(by.A.id); // the outermost folded one
    expect(nearestVisibleId(state.sceneRoot, [by.A1.id], by.A1.id)).toBe(by.A1.id); // a folded node is itself shown
  });
});
