import { createBlankSceneTree, createProjectSnapshot, createSceneNode, findSceneNode, flattenSceneTreeInOrder, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { canMoveNodes, createInitialState, editorReducer, hasUnsavedChanges, selectedNodeIdsOf, type Action, type EditorState } from "./editor-store";

/** requirements/node-list/STORY.select-and-reorder-nodes.md. Tree: Main > [A > [A1, A2], B, C > [C1], D] */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
const n = (name: string, kind: SceneNode["kind"], children: SceneNode[] = []): SceneNode => createSceneNode({ name, kind, children });

function open(mode: "2D" | "3D" = "2D"): { state: EditorState; by: Record<string, SceneNode> } {
  const kind = mode === "2D" ? "Node2D" : "Node3D";
  const A1 = n("A1", kind);
  const A2 = n("A2", kind);
  const A = n("A", kind, [A1, A2]);
  const B = n("B", kind);
  const C1 = n("C1", kind);
  const C = n("C", kind, [C1]);
  const D = n("D", kind);
  const scene = { ...createBlankSceneTree(mode), children: [A, B, C, D] };
  const state = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: createProjectSnapshot({ name: "P", mode, scene }) });
  return { state, by: { Main: scene, A, A1, A2, B, C, C1, D } };
}
const click = (id: string): Action => ({ type: "SELECT_NODE", id });
const ctrl = (id: string): Action => ({ type: "SELECT_NODE_MODIFIED", id, mode: "toggle" });
const shift = (id: string): Action => ({ type: "SELECT_NODE_MODIFIED", id, mode: "range" });
const names = (s: EditorState, ids: string[] = selectedNodeIdsOf(s)): string[] => ids.map((id) => findSceneNode(s.sceneRoot, id)!.name).sort();
const shape = (node: SceneNode): string => (node.children.length === 0 ? node.name : `${node.name}(${node.children.map(shape).join(" ")})`);
const undo: Action = { type: "UNDO" };

describe("selecting several nodes", () => {
  it("Ctrl+click adds a node to the selection and makes it the one the Inspector shows", () => {
    const { state, by } = open();
    const s = run(state, click(by.A.id), ctrl(by.C.id), ctrl(by.D.id));
    expect(names(s)).toEqual(["A", "C", "D"]);
    expect(s.selectedNodeId).toBe(by.D.id);
    expect(s.extraSelectedIds).toHaveLength(2);
  });

  it("Ctrl+click on a selected node takes it out; taking out the primary hands over to another; the last one out leaves the scene root", () => {
    const { state, by } = open();
    const three = run(state, click(by.A.id), ctrl(by.B.id), ctrl(by.C.id));
    expect(names(run(three, ctrl(by.B.id)))).toEqual(["A", "C"]);
    const noPrimary = run(three, ctrl(by.C.id));
    expect(names(noPrimary)).toEqual(["A", "B"]);
    expect(noPrimary.selectedNodeId).toBe(by.B.id);
    const last = run(state, click(by.A.id), ctrl(by.A.id));
    expect(last.selectedNodeId).toBe(by.Main.id);
    expect(last.extraSelectedIds).toEqual([]);
  });

  it("Shift+click selects every node from the last one clicked to this one, in tree order (parents and their children alike)", () => {
    const { state, by } = open();
    expect(names(run(state, click(by.A1.id), shift(by.C.id)))).toEqual(["A1", "A2", "B", "C"]);
    expect(names(run(state, click(by.C.id), shift(by.A2.id)))).toEqual(["A2", "B", "C"]); // upwards works too
    // Another Shift+click measures from the same anchor, not from the last end of the range.
    expect(names(run(state, click(by.B.id), shift(by.D.id), shift(by.A.id)))).toEqual(["A", "A1", "A2", "B"]);
  });

  it("Ctrl+click moves the anchor, so a later Shift+click selects the range from the node just Ctrl+clicked (and replaces the rest of the selection)", () => {
    const { state, by } = open();
    const s = run(state, click(by.A.id), ctrl(by.C.id), shift(by.D.id));
    expect(names(s)).toEqual(["C", "C1", "D"]);
  });

  it("a plain click, adding a node, or an undo goes back to a single selection", () => {
    const { state, by } = open();
    const many = run(state, click(by.A.id), ctrl(by.C.id));
    expect(selectedNodeIdsOf(run(many, click(by.B.id)))).toEqual([by.B.id]);
    expect(selectedNodeIdsOf(run(many, click(by.C.id)))).toEqual([by.C.id]); // a plain click on the primary collapses the selection too
    expect(run(many, { type: "ADD_NODE", kind: "Node2D" }).extraSelectedIds).toEqual([]);
  });

  it("a selected node that is deleted drops out of the selection", () => {
    const { state, by } = open();
    const s = run(state, click(by.A.id), ctrl(by.B.id), ctrl(by.C.id), { type: "DELETE_NODE", id: by.A.id });
    expect(names(s)).toEqual(["B", "C"]);
  });
});

describe("deleting and duplicating a selection", () => {
  it("deletes every selected node (and what is under it) as one undo step", () => {
    const { state, by } = open();
    const selected = run(state, click(by.A.id), ctrl(by.C.id), ctrl(by.A1.id));
    const deleted = run(selected, { type: "DELETE_NODES" });
    expect(shape(deleted.sceneRoot)).toBe("Main(B D)");
    expect(deleted.selectedNodeId).toBe(by.Main.id);
    expect(deleted.extraSelectedIds).toEqual([]);
    expect(hasUnsavedChanges(deleted)).toBe(true);
    expect(deleted.outputLog.at(-1)).toBe("Deleted 2 nodes."); // A1 went with A
    expect(shape(run(deleted, undo).sceneRoot)).toBe("Main(A(A1 A2) B C(C1) D)");
  });

  it("never deletes the scene root, even when it is selected with others", () => {
    const { state, by } = open();
    const s = run(state, click(by.Main.id), ctrl(by.B.id), { type: "DELETE_NODES" });
    expect(shape(s.sceneRoot)).toBe("Main(A(A1 A2) C(C1) D)");
    expect(run(state, { type: "DELETE_NODES" })).toBe(state); // only the root selected: nothing to do
  });

  it("duplicates every selected node next to its original, names the copies, selects them, and undoes as one step", () => {
    const { state, by } = open();
    const copies = run(state, click(by.B.id), ctrl(by.D.id), { type: "DUPLICATE_NODES" });
    expect(shape(copies.sceneRoot)).toBe("Main(A(A1 A2) B B2 C(C1) D D2)");
    expect(names(copies)).toEqual(["B2", "D2"]);
    expect(copies.outputLog.at(-1)).toBe("Duplicated 2 nodes.");
    expect(shape(run(copies, undo).sceneRoot)).toBe("Main(A(A1 A2) B C(C1) D)");
  });

  it("duplicating a node and something inside it copies it once", () => {
    const { state, by } = open();
    const copies = run(state, click(by.A.id), ctrl(by.A1.id), { type: "DUPLICATE_NODES" });
    expect(shape(copies.sceneRoot)).toBe("Main(A(A1 A2) A2(A1 A2) B C(C1) D)");
  });
});

describe("dragging nodes in the tree", () => {
  it("moves a node before, after or inside another, keeps it selected, and undoes as one step", () => {
    const { state, by } = open();
    const moved = run(state, click(by.D.id), { type: "MOVE_NODES", ids: [by.D.id], targetId: by.A.id, position: "before" });
    expect(shape(moved.sceneRoot)).toBe("Main(D A(A1 A2) B C(C1))");
    expect(moved.selectedNodeId).toBe(by.D.id);
    expect(hasUnsavedChanges(moved)).toBe(true);
    expect(moved.outputLog.at(-1)).toBe('Moved "D" before "A".');
    expect(shape(run(moved, undo).sceneRoot)).toBe("Main(A(A1 A2) B C(C1) D)");
    expect(shape(run(state, { type: "MOVE_NODES", ids: [by.B.id], targetId: by.C.id, position: "inside" }).sceneRoot)).toBe("Main(A(A1 A2) C(C1 B) D)");
  });

  it("moves the whole selection together, keeping the selection", () => {
    const { state, by } = open();
    const selected = run(state, click(by.A1.id), ctrl(by.D.id));
    const moved = run(selected, { type: "MOVE_NODES", ids: selectedNodeIdsOf(selected), targetId: by.B.id, position: "after" });
    expect(shape(moved.sceneRoot)).toBe("Main(A(A2) B A1 D C(C1))");
    expect(names(moved)).toEqual(["A1", "D"]);
    expect(moved.outputLog.at(-1)).toBe('Moved 2 nodes after "B".');
  });

  it("does nothing for a drop into itself, beside the root, or where the node already is, and adds no undo step", () => {
    const { state, by } = open();
    for (const action of [
      { type: "MOVE_NODES", ids: [by.A.id], targetId: by.A1.id, position: "inside" },
      { type: "MOVE_NODES", ids: [by.B.id], targetId: by.Main.id, position: "before" },
      { type: "MOVE_NODES", ids: [by.B.id], targetId: by.C.id, position: "before" }
    ] as Action[]) {
      expect(run(state, action)).toBe(state);
    }
  });

  it("tells the tree whether a drop is allowed", () => {
    const { state, by } = open();
    expect(canMoveNodes(state, [by.D.id], by.A.id, "before")).toBe(true);
    expect(canMoveNodes(state, [by.A.id], by.A1.id, "inside")).toBe(false);
    expect(canMoveNodes(state, [by.B.id], by.Main.id, "after")).toBe(false);
  });

  it("in a 3D project keeps 2D nodes out from under 3D nodes, and 3D nodes out from under 2D nodes, but lets the root and the players take anything", () => {
    const mesh = n("Cube", "MeshInstance3D");
    const group = n("Group", "Node3D");
    const sprite = n("Hero", "Sprite2D");
    const label = n("Text", "Label");
    const player = n("Sfx", "AudioStreamPlayer");
    const scene = { ...createBlankSceneTree("3D"), children: [mesh, group, sprite, label, player] };
    const state = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: createProjectSnapshot({ name: "P", mode: "3D", scene }) });
    expect(canMoveNodes(state, [sprite.id], group.id, "inside")).toBe(false); // a 2D node under a 3D one
    expect(canMoveNodes(state, [mesh.id], label.id, "inside")).toBe(false); // a 3D node under a 2D one
    expect(canMoveNodes(state, [sprite.id], label.id, "inside")).toBe(true); // 2D under 2D
    expect(canMoveNodes(state, [mesh.id], group.id, "inside")).toBe(true);
    expect(canMoveNodes(state, [player.id], group.id, "inside")).toBe(true); // a player goes anywhere
    expect(canMoveNodes(state, [sprite.id], state.sceneRoot.id, "inside")).toBe(true); // the root takes anything
    const inOrder = flattenSceneTreeInOrder(state.sceneRoot).map((x) => x.name);
    expect(inOrder[0]).toBe("Main");
  });
});
