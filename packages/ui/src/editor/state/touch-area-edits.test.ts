import { createBlankSceneTree, createProjectSnapshot, findSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

/** requirements/touch/TASK.touch-area-editor.md */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(mode: "2D" | "3D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const with2D = (): { state: EditorState; id: string } => {
  const state = run(openProject("2D"), { type: "ADD_NODE", kind: "TouchArea2D" });
  return { state, id: state.selectedNodeId };
};
const with3D = (): { state: EditorState; id: string } => {
  const state = run(openProject("3D"), { type: "ADD_NODE", kind: "TouchArea3D" });
  return { state, id: state.selectedNodeId };
};
const node = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!;
const undo: Action = { type: "UNDO" };

describe("editing touch areas", () => {
  it("a TouchArea2D can be added to a 2D project, and a TouchArea3D to a 3D project (not the other way round)", () => {
    expect(with2D().state.sceneRoot.children.map((c) => c.kind)).toEqual(["TouchArea2D"]);
    expect(with3D().state.sceneRoot.children.map((c) => c.kind)).toEqual(["TouchArea3D"]);
    const rejected = run(openProject("2D"), { type: "ADD_NODE", kind: "TouchArea3D" });
    expect(rejected.sceneRoot.children).toEqual([]);
  });

  it("a new TouchArea3D has a 3D transform and a new TouchArea2D a 2D position", () => {
    const { state: s3, id: i3 } = with3D();
    expect(node(s3, i3).transform3D).toBeDefined();
    const { state: s2, id: i2 } = with2D();
    expect(node(s2, i2).transform3D).toBeUndefined();
  });

  it("changes a rectangle's width and height, keeping them in whole pixels inside the screen", () => {
    const { state, id } = with2D();
    const wider = run(state, { type: "SET_TOUCH_AREA_2D", id, change: { width: 120 }, at: 1 });
    expect(node(wider, id).touchArea2D).toEqual({ width: 120, height: 64 });
    expect(hasUnsavedChanges(wider)).toBe(true);
    expect(node(run(wider, { type: "SET_TOUCH_AREA_2D", id, change: { height: 5000 }, at: 999999 }), id).touchArea2D).toEqual({ width: 120, height: 192 });
    expect(node(run(wider, { type: "SET_TOUCH_AREA_2D", id, change: { width: NaN }, at: 3 }), id).touchArea2D).toEqual({ width: 120, height: 64 });
  });

  it("setting a value it already has (a default included) is not an edit", () => {
    const { state, id } = with2D();
    expect(run(state, { type: "SET_TOUCH_AREA_2D", id, change: { width: 64 }, at: 1 })).toBe(state);
    const { state: s3, id: i3 } = with3D();
    expect(run(s3, { type: "SET_TOUCH_AREA_3D", id: i3, change: { shape: "box" }, at: 1 })).toBe(s3);
    expect(run(s3, { type: "SET_TOUCH_AREA_3D", id: i3, change: { size: { x: 1 } }, at: 1 })).toBe(s3);
  });

  it("changes a TouchArea3D's shape and sizes, each field keeping the others", () => {
    const { state, id } = with3D();
    const sphere = run(state, { type: "SET_TOUCH_AREA_3D", id, change: { shape: "sphere" }, at: 1 }, { type: "SET_TOUCH_AREA_3D", id, change: { radius: 2.5 }, at: 2 });
    expect(node(sphere, id).touchArea3D).toMatchObject({ shape: "sphere", radius: 2.5, size: { x: 1, y: 1, z: 1 } });
    const box = run(sphere, { type: "SET_TOUCH_AREA_3D", id, change: { shape: "box" }, at: 3 }, { type: "SET_TOUCH_AREA_3D", id, change: { size: { y: 4 } }, at: 4 });
    expect(node(box, id).touchArea3D).toMatchObject({ shape: "box", radius: 2.5, size: { x: 1, y: 4, z: 1 } });
    expect(node(run(box, { type: "SET_TOUCH_AREA_3D", id, change: { radius: -3 }, at: 5 }), id).touchArea3D!.radius).toBe(0.01);
  });

  it("ignores the wrong kind of node", () => {
    const { state, id } = with2D();
    expect(run(state, { type: "SET_TOUCH_AREA_3D", id, change: { shape: "sphere" }, at: 1 })).toBe(state);
    const { state: s3, id: i3 } = with3D();
    expect(run(s3, { type: "SET_TOUCH_AREA_2D", id: i3, change: { width: 10 }, at: 1 })).toBe(s3);
  });

  it("typing in a field is one undo step per pause, and a shape change its own step", () => {
    const { state, id } = with3D();
    const typed = run(
      state,
      { type: "SET_TOUCH_AREA_3D", id, change: { size: { x: 2 } }, at: 100 },
      { type: "SET_TOUCH_AREA_3D", id, change: { size: { x: 25 } }, at: 400 },
      { type: "SET_TOUCH_AREA_3D", id, change: { shape: "sphere" }, at: 500 }
    );
    expect(node(typed, id).touchArea3D).toMatchObject({ shape: "sphere", size: { x: 25 } });
    expect(node(run(typed, undo), id).touchArea3D).toMatchObject({ shape: "box", size: { x: 25 } }); // the shape change alone
    expect(node(run(typed, undo, undo), id).touchArea3D).toBeUndefined(); // both typed changes together
  });

  it("duplicating keeps the settings", () => {
    const { state, id } = with2D();
    const sized = run(state, { type: "SET_TOUCH_AREA_2D", id, change: { width: 30, height: 20 }, at: 1 }, { type: "DUPLICATE_NODE", id });
    const copies = sized.sceneRoot.children.filter((c) => c.kind === "TouchArea2D");
    expect(copies).toHaveLength(2);
    expect(copies[1].touchArea2D).toEqual({ width: 30, height: 20 });
  });
});
