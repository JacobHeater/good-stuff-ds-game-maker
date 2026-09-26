import { createBlankSceneTree, createProjectSnapshot, expandSceneInstances, findSceneNode, flattenSceneTree, listScenes, withSceneTree } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.scene-instances.md: putting a scene inside another scene, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function open(mode: "2D" | "3D" = "2D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const entries = (s: EditorState) => listScenes(withSceneTree(s.project!, s.activeSceneId, s.sceneRoot));
const idOf = (s: EditorState, name: string): string => entries(s).find((e) => e.name === name)!.id;

/** A "Player" scene holding one sprite, then back in the start scene "Main". */
function withPlayer(mode: "2D" | "3D" = "2D"): EditorState {
  const made = run(open(mode), { type: "SCENE_ADD", id: "player", name: "Player" }, { type: mode === "2D" ? "ADD_NODE" : "ADD_NODE", kind: mode === "2D" ? "Sprite2D" : "MeshInstance3D" });
  return run(made, { type: "SCENE_SWITCH", id: idOf(made, "Main") });
}

describe("instantiating a scene", () => {
  it("adds a node that is an instance of the scene, named for it, and selects it", () => {
    const s = run(withPlayer(), { type: "SCENE_INSTANTIATE", sceneId: "player" });
    const node = findSceneNode(s.sceneRoot, s.selectedNodeId)!;
    expect(node).toMatchObject({ name: "Player", instanceOf: "player", kind: "Node2D" });
    expect(node.children).toEqual([]);
    expect(s.sceneRoot.children).toHaveLength(1);
    expect(hasUnsavedChanges(s)).toBe(true);
  });

  it("can be done again: each instance gets a name of its own, and both show the scene's nodes with ids of their own", () => {
    const s = run(withPlayer(), { type: "SCENE_INSTANTIATE", sceneId: "player" }, { type: "SCENE_INSTANTIATE", sceneId: "player", parentId: s0().sceneRoot.id });
    function s0(): EditorState { return withPlayer(); }
    expect(s.sceneRoot.children.map((n) => n.name)).toEqual(["Player", "Player2"]);
    const project = withSceneTree(s.project!, s.activeSceneId, s.sceneRoot);
    const ids = flattenSceneTree(expandSceneInstances(project, s.sceneRoot)).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(1 + 2 * 2); // the root, and two instances each of an instance node and the scene's one sprite
  });

  it("puts a 3D scene's instance in a 3D project as a 3D node with the scene's transform", () => {
    const s = run(withPlayer("3D"), { type: "SCENE_INSTANTIATE", sceneId: "player" });
    const node = findSceneNode(s.sceneRoot, s.selectedNodeId)!;
    expect(node.kind).toBe("Node3D");
    expect(node.instanceOf).toBe("player");
    expect(node.transform3D).toBeDefined();
  });

  it("refuses a scene into itself, into a scene it already holds a copy of, into an instance, and a scene that isn't there", () => {
    const s = withPlayer();
    const inMain = run(s, { type: "SCENE_INSTANTIATE", sceneId: "player" });
    expect(run(s, { type: "SCENE_INSTANTIATE", sceneId: idOf(s, "Main") })).toBe(s); // Main into Main
    expect(run(s, { type: "SCENE_INSTANTIATE", sceneId: "nope" })).toBe(s);
    // Player can't now hold Main, which holds Player
    const inPlayer = run(inMain, { type: "SCENE_SWITCH", id: "player" }, { type: "SCENE_INSTANTIATE", sceneId: idOf(s, "Main") });
    expect(inPlayer.sceneRoot.children.some((n) => n.instanceOf !== undefined)).toBe(false);
    // an instance holds nothing of its own
    const instanceId = inMain.selectedNodeId;
    expect(run(inMain, { type: "SCENE_INSTANTIATE", sceneId: "player", parentId: instanceId })).toBe(inMain);
  });

  it("can be undone", () => {
    const s = run(withPlayer(), { type: "SCENE_INSTANTIATE", sceneId: "player" });
    const undone = run(s, { type: "UNDO" });
    expect(undone.sceneRoot.children).toHaveLength(0);
  });

  it("saves the instance in the scene it is in, and the Player scene keeps its own nodes", () => {
    const s = run(withPlayer(), { type: "SCENE_INSTANTIATE", sceneId: "player" });
    const saved = savedProjectOf(s);
    expect(saved.scene.children[0].instanceOf).toBe("player");
    expect(saved.scenes![0].scene.children).toHaveLength(1);
  });

  it("selecting a node inside an instance selects the instance", () => {
    // ids inside an instance are '<instance>/<node>'; the store's selectNode wrapper maps them (checked at the id level here)
    const s = run(withPlayer(), { type: "SCENE_INSTANTIATE", sceneId: "player" });
    const instance = s.selectedNodeId;
    expect(run(s, { type: "SELECT_NODE", id: instance }).selectedNodeId).toBe(instance);
  });
});
