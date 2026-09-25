import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getCollisionShape } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function withShape(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "CollisionShape3D" });
  return { state, id: state.selectedNodeId };
}
const shapeOf = (state: EditorState, id: string) => getCollisionShape(findSceneNode(state.sceneRoot, id)!);
const set = (id: string, change: Extract<Action, { type: "SET_COLLISION_SHAPE" }>["change"], at = 0): Action => ({ type: "SET_COLLISION_SHAPE", id, change, at });

describe("editing a collision shape", () => {
  it("starts as a unit box", () => {
    const { state, id } = withShape();
    expect(shapeOf(state, id)).toEqual({ shape: "box", size: { x: 1, y: 1, z: 1 }, radius: 0.5, height: 2, solid: false });
    expect(findSceneNode(state.sceneRoot, id)!.collision).toBeUndefined();
  });

  it("changes the shape and keeps the other sizes, so changing back shows the earlier box", () => {
    const { state, id } = withShape();
    const boxed = run(state, set(id, { size: { x: 2, y: 3, z: 4 } }, 0), set(id, { shape: "sphere" }), set(id, { radius: 1.5 }, 5000), set(id, { shape: "box" }));
    expect(shapeOf(boxed, id)).toMatchObject({ shape: "box", size: { x: 2, y: 3, z: 4 }, radius: 1.5 });
  });

  it("changes only the box axes named", () => {
    const { state, id } = withShape();
    expect(shapeOf(run(state, set(id, { size: { y: 5 } })), id).size).toEqual({ x: 1, y: 5, z: 1 });
  });

  it("raises a capsule's height with its radius and its own height up to twice the radius", () => {
    const { state, id } = withShape();
    const capsule = run(state, set(id, { shape: "capsule" }));
    expect(shapeOf(run(capsule, set(id, { radius: 1.5 }, 5000)), id).height).toBe(3);
    expect(shapeOf(run(capsule, set(id, { height: 0.2 }, 5000)), id).height).toBe(1); // twice the radius, 0.5
  });

  it("keeps values in range and ignores numbers that aren't", () => {
    const { state, id } = withShape();
    expect(shapeOf(run(state, set(id, { radius: 0 })), id).radius).toBe(0.01);
    expect(shapeOf(run(state, set(id, { radius: 99999 })), id).radius).toBe(1000);
    expect(run(state, set(id, { radius: NaN }))).toBe(state);
    expect(run(state, set(id, { height: Infinity }))).toBe(state);
  });

  it("isn't an edit to set what it already is, on a shape that never had settings", () => {
    const { state, id } = withShape();
    expect(run(state, set(id, { shape: "box" }))).toBe(state);
    expect(run(state, set(id, { radius: 0.5 }))).toBe(state);
    expect(run(state, set(id, { size: { x: 1, y: 1, z: 1 } }))).toBe(state);
  });

  it("only applies to a CollisionShape3D", () => {
    const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
    const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
    const mesh = run(opened, { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(mesh, set(mesh.selectedNodeId, { radius: 2 }))).toBe(mesh);
    expect(run(mesh, set("missing", { radius: 2 }))).toBe(mesh);
  });

  it("is undoable: typing merges into one step per pause per field, and the shape is its own step", () => {
    const { state, id } = withShape();
    const steps = state.history.past.length;
    let typed = run(state, set(id, { shape: "cylinder" }, 1000));
    for (let i = 1; i <= 5; i++) typed = run(typed, set(id, { radius: 0.5 + i * 0.1 }, 1000 + i * 100));
    expect(typed.history.past).toHaveLength(steps + 2);
    expect(typed.history.past.at(-1)!.label).toBe("Change radius of CollisionShape3D");
    const undone = run(typed, { type: "UNDO" });
    expect(shapeOf(undone, id)).toMatchObject({ shape: "cylinder", radius: 0.5 });
    expect(shapeOf(run(undone, { type: "UNDO" }), id).shape).toBe("box");
    // A different field is its own step even right after.
    const two = run(state, set(id, { radius: 1 }, 1000), set(id, { height: 3 }, 1100));
    expect(two.history.past).toHaveLength(steps + 2);
    expect(shapeOf(run(two, { type: "REDO" }), id).height).toBe(3);
  });

  it("turns solid on and off, as its own undo step, and setting what it already is is no edit", () => {
    const { state, id } = withShape();
    expect(shapeOf(state, id).solid).toBe(false);
    expect(run(state, set(id, { solid: false }))).toBe(state);
    const solid = run(state, set(id, { solid: true }));
    expect(shapeOf(solid, id).solid).toBe(true);
    expect(solid.history.past.at(-1)!.label).toBe("Turn solid on for CollisionShape3D");
    expect(shapeOf(run(solid, { type: "UNDO" }), id).solid).toBe(false);
    // Editing a size afterwards keeps it solid.
    expect(shapeOf(run(solid, set(id, { radius: 2 }, 9000)), id).solid).toBe(true);
    // And changing the shape keeps it solid too.
    expect(shapeOf(run(solid, set(id, { shape: "sphere" })), id).solid).toBe(true);
  });

  it("is an unsaved change, and a duplicate keeps the shape", () => {
    const { state, id } = withShape();
    const edited = run(state, set(id, { shape: "sphere" }), set(id, { radius: 2 }, 9000), { type: "DUPLICATE_NODE", id });
    const copies = [...flat(edited.sceneRoot)].filter((node) => node.kind === "CollisionShape3D");
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(getCollisionShape(copy)).toMatchObject({ shape: "sphere", radius: 2 });
  });
});

function* flat(node: import("@goodstuff/core").SceneNode): Generator<import("@goodstuff/core").SceneNode> {
  yield node;
  for (const child of node.children) yield* flat(child);
}
