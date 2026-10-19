import { createProjectSnapshot, createSceneNode, DEFAULT_START_SCENE_ID, findSceneNode, withSceneEntries, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.spawn-pools.md: a scene instance's own spawnPoolCount, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);

function withPoolInstance(): { state: EditorState; id: string } {
  const instance = { ...createSceneNode({ name: "Campfires", kind: "Node2D" }), instanceOf: "campfire" };
  const level = createSceneNode({ name: "Level", kind: "Node2D", children: [instance] });
  const project: ProjectSnapshot = withSceneEntries(createProjectSnapshot({ name: "P", mode: "2D", scene: level }), [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
    { id: "campfire", name: "Campfire", scene: createSceneNode({ name: "CampfireRoot", kind: "Node2D" }), isStart: false }
  ]);
  const state = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  return { state, id: instance.id };
}
const poolCountOf = (s: EditorState, id: string) => findSceneNode(s.sceneRoot, id)!.spawnPoolCount;

describe("a scene instance's own spawn pool count", () => {
  it("is unset (an ordinary instance) by default, can be set, and undone", () => {
    const { state, id } = withPoolInstance();
    expect(poolCountOf(state, id)).toBeUndefined();
    const pooled = run(state, { type: "SET_SPAWN_POOL_COUNT", id, count: 5, at: 0 });
    expect(poolCountOf(pooled, id)).toBe(5);
    const changed = run(pooled, { type: "SET_SPAWN_POOL_COUNT", id, count: 3, at: 2000 }); // past MERGE_WINDOW_MS: its own undo step, not merged into the first
    expect(poolCountOf(changed, id)).toBe(3);
    expect(poolCountOf(run(changed, { type: "UNDO" }), id)).toBe(5);
  });

  it("clamps to 1..SPAWN_POOL_COUNT_MAX (16)", () => {
    const { state, id } = withPoolInstance();
    expect(poolCountOf(run(state, { type: "SET_SPAWN_POOL_COUNT", id, count: 0, at: 1 }), id)).toBe(1);
    expect(poolCountOf(run(state, { type: "SET_SPAWN_POOL_COUNT", id, count: 1000, at: 1 }), id)).toBe(16);
  });

  it("ignores setting what it already is, and a node that isn't an instance at all", () => {
    const { state, id } = withPoolInstance();
    const pooled = run(state, { type: "SET_SPAWN_POOL_COUNT", id, count: 5, at: 1 });
    expect(run(pooled, { type: "SET_SPAWN_POOL_COUNT", id, count: 5, at: 2 })).toBe(pooled);
    const other = run(state, { type: "ADD_NODE", kind: "Node2D" });
    expect(run(other, { type: "SET_SPAWN_POOL_COUNT", id: other.selectedNodeId!, count: 5, at: 1 })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, id } = withPoolInstance();
    const saved = savedProjectOf(run(state, { type: "SET_SPAWN_POOL_COUNT", id, count: 4, at: 1 }));
    expect(saved.scene.children.find((n) => n.id === id)!.spawnPoolCount).toBe(4);
  });
});
