import { createBlankSceneTree, createProjectSnapshot, createSceneNode, flattenSceneTree, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/** Duplicating a node gives the copy its own name among its siblings and leaves what is under it alone. */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function open(children: SceneNode[]): EditorState {
  const scene = { ...createBlankSceneTree("3D"), children };
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: createProjectSnapshot({ name: "P", mode: "3D", scene }) });
}
const names = (s: EditorState, of = s.sceneRoot): string[] => of.children.map((c) => c.name);

describe("duplicating a node", () => {
  const block = (): SceneNode => createSceneNode({ name: "JengaBlock", kind: "MeshInstance3D", children: [createSceneNode({ name: "JengaTouch", kind: "TouchArea3D" })] });

  it("names the copy JengaBlock2, then JengaBlock3, next to the original, and selects it", () => {
    const original = block();
    const once = run(open([original]), { type: "DUPLICATE_NODE", id: original.id });
    expect(names(once)).toEqual(["JengaBlock", "JengaBlock2"]);
    expect(once.sceneRoot.children[1].id).toBe(once.selectedNodeId);
    const twice = run(once, { type: "DUPLICATE_NODE", id: original.id });
    expect(names(twice)).toEqual(["JengaBlock", "JengaBlock3", "JengaBlock2"]);
    expect(twice.outputLog.at(-1)).toBe('Duplicated node "JengaBlock" as "JengaBlock3".');
  });

  it("duplicating a copy counts on from its number instead of appending to it", () => {
    const original = block();
    const once = run(open([original]), { type: "DUPLICATE_NODE", id: original.id });
    const copy = once.sceneRoot.children[1];
    expect(names(run(once, { type: "DUPLICATE_NODE", id: copy.id }))).toEqual(["JengaBlock", "JengaBlock2", "JengaBlock3"]);
  });

  it("what is under the copy keeps its names and gets new ids, so each block has its own JengaTouch", () => {
    const original = block();
    const once = run(open([original]), { type: "DUPLICATE_NODE", id: original.id });
    const [first, second] = once.sceneRoot.children;
    expect(names(once, first)).toEqual(["JengaTouch"]);
    expect(names(once, second)).toEqual(["JengaTouch"]);
    expect(first.children[0].id).not.toBe(second.children[0].id);
    expect(new Set(flattenSceneTree(once.sceneRoot).map((n) => n.id)).size).toBe(flattenSceneTree(once.sceneRoot).length);
  });

  it("is one undo step, and a node inside a parent is numbered among that parent's children", () => {
    const original = block();
    const nested = createSceneNode({ name: "Tower", kind: "Node3D", children: [original] });
    const once = run(open([nested]), { type: "DUPLICATE_NODE", id: original.id });
    expect(names(once, once.sceneRoot.children[0])).toEqual(["JengaBlock", "JengaBlock2"]);
    const undone = run(once, { type: "UNDO" });
    expect(names(undone, undone.sceneRoot.children[0])).toEqual(["JengaBlock"]);
  });
});
