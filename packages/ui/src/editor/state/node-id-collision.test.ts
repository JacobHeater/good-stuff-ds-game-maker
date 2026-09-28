import { createBlankSceneTree, createProjectSnapshot, createSceneNode, flattenAllScenes, flattenSceneTree, type ProjectScene } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/**
 * A bug report: instancing a scene ("Map") into another ("World") was intentional, but afterward, duplicating a node made Map's contents show up
 * merged into a different node. Root cause: the node id counter (scene-node.ts) is shared by the whole app session and only ever counts up; a
 * project saved by an earlier session already has ids from ITS count, which opening the project never told this session about. Once this
 * session's own count reached a number an earlier one had already used and saved, a duplicate or a new node could mint an id that collided with
 * an existing one -- two different nodes sharing an id, which is exactly what makes one look like it's "inside" the wrong node. Fixed by
 * ensureNodeIdsAbove, called when a project is opened.
 */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}

describe("a project's own ids never collide with ones minted after it's opened", () => {
  it("duplicating a node can't produce an id an instanced scene already has, however high that scene's own ids are", () => {
    // "Map", a separate scene from an earlier session, with a node id number this fresh session's own counter would otherwise pass right through.
    const mapNode = { ...createSceneNode({ name: "MapGround", kind: "MeshInstance3D" }), id: "meshinstance3d-9001" };
    const mapScene = { ...createBlankSceneTree("3D"), name: "Map", children: [mapNode] };
    // "World", the project's starting scene, with an instance of Map and an ordinary node to duplicate.
    const toDuplicate = createSceneNode({ name: "Player", kind: "MeshInstance3D" });
    const mapInstance = { ...createSceneNode({ name: "Map", kind: "Node3D" }), instanceOf: "map-scene" };
    const worldScene = { ...createBlankSceneTree("3D"), name: "World", children: [toDuplicate, mapInstance] };
    const project = createProjectSnapshot({ name: "P", mode: "3D", scene: worldScene });
    const withMap = { ...project, scenes: [{ id: "map-scene", name: "Map", scene: mapScene } satisfies ProjectScene] };

    const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: withMap });
    // A single duplicate right after opening: without the fix, a session that happens to be freshly started counts up from wherever it already
    // was (often near 0), which would walk straight through 9001 the moment enough nodes had been made -- this proves opening the project itself
    // is what raises the count, not some coincidence of how many nodes happened to be made first.
    const state = run(opened, { type: "DUPLICATE_NODE", id: toDuplicate.id });
    const newNode = flattenSceneTree(state.sceneRoot).find((n) => !flattenSceneTree(worldScene).some((original) => original.id === n.id))!;
    const newNumber = Number(/-(\d+)$/.exec(newNode.id)![1]);
    expect(newNumber).toBeGreaterThan(9001);

    const everyIdInTheProject = flattenAllScenes(withMap).map((n) => n.id);
    expect(everyIdInTheProject).not.toContain(newNode.id);
    // No two nodes anywhere in the (still separate) scenes ended up sharing an id.
    const all = [...flattenSceneTree(state.sceneRoot).map((n) => n.id), ...flattenSceneTree(mapScene).map((n) => n.id)];
    expect(new Set(all).size).toBe(all.length);
  });
});
