import { createBlankSceneTree, createProjectSnapshot, findSceneNode, listScenes, sceneNamesOf, withSceneTree, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.multiple-scenes.md: adding, switching, renaming, deleting and duplicating scenes in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function open(mode: "2D" | "3D" = "2D"): { state: EditorState; project: ProjectSnapshot } {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return { project, state: editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project }) };
}
const names = (s: EditorState): string[] => sceneNamesOf(withSceneTree(s.project!, s.activeSceneId, s.sceneRoot));
const entries = (s: EditorState) => listScenes(withSceneTree(s.project!, s.activeSceneId, s.sceneRoot));
const idOf = (s: EditorState, name: string): string => entries(s).find((e) => e.name === name)!.id;
const undo: Action = { type: "UNDO" };
const redo: Action = { type: "REDO" };

describe("adding and switching scenes", () => {
  it("starts with one scene, named as the root, that is the start and is being edited", () => {
    const { state } = open();
    expect(entries(state)).toHaveLength(1);
    expect(entries(state)[0]).toMatchObject({ name: "Main", isStart: true });
    expect(entries(state)[0].id).toBe(state.activeSceneId);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("adds an empty scene, opens it, and gives it a name no scene has", () => {
    const { state } = open();
    const two = run(state, { type: "SCENE_ADD", id: "a", name: "Level" }, { type: "SCENE_ADD", id: "b", name: "Level" });
    expect(names(two)).toEqual(["Main", "Level", "Level2"]);
    expect(two.activeSceneId).toBe("b");
    expect(two.sceneRoot.name).toBe("Level2");
    expect(two.sceneRoot.children).toHaveLength(0);
    expect(two.selectedNodeId).toBe(two.sceneRoot.id);
    expect(hasUnsavedChanges(two)).toBe(true);
  });

  it("switches between scenes keeping each scene's edits, without making an edit", () => {
    const { state } = open();
    const added = run(state, { type: "SCENE_ADD", id: "a", name: "Level" }, { type: "ADD_NODE", kind: "Sprite2D" });
    expect(added.sceneRoot.children.map((n) => n.kind)).toEqual(["Sprite2D"]);
    const back = run(added, { type: "SCENE_SWITCH", id: idOf(added, "Main") });
    expect(back.activeSceneId).toBe(idOf(added, "Main"));
    expect(back.sceneRoot.children).toHaveLength(0);
    const again = run(back, { type: "SCENE_SWITCH", id: "a" });
    expect(again.sceneRoot.children.map((n) => n.kind)).toEqual(["Sprite2D"]);
    // switching is not an edit: it leaves nothing on the undo stack beyond the two edits, and doesn't make a saved project unsaved
    expect(again.history.past).toHaveLength(2);
    expect(run(again, { type: "SCENE_SWITCH", id: "nope" })).toBe(again);
    expect(run(again, { type: "SCENE_SWITCH", id: "a" })).toBe(again);
  });

  it("a saved project stays clean when only the scene being edited is switched", () => {
    const { state } = open();
    const two = run(state, { type: "SCENE_ADD", id: "a", name: "Level" });
    const saved = run(two, { type: "PROJECT_SAVED", filePath: "p.gsds", project: savedProjectOf(two) });
    expect(hasUnsavedChanges(saved)).toBe(false);
    expect(hasUnsavedChanges(run(saved, { type: "SCENE_SWITCH", id: idOf(saved, "Main") }))).toBe(false);
    // ...and editing a scene other than the first makes it unsaved
    expect(hasUnsavedChanges(run(saved, { type: "ADD_NODE", kind: "Sprite2D" }))).toBe(true);
  });
});

describe("renaming, the start scene, duplicating and deleting", () => {
  const twoScenes = (): EditorState => run(open().state, { type: "SCENE_ADD", id: "a", name: "Level" });

  it("renames a scene, refusing an empty name or one another scene has, and the start scene's name is kept", () => {
    const s = twoScenes();
    const renamed = run(s, { type: "SCENE_RENAME", id: "a", name: "Cave", at: 1 });
    expect(names(renamed)).toEqual(["Main", "Cave"]);
    expect(run(s, { type: "SCENE_RENAME", id: "a", name: "  ", at: 1 })).toBe(s);
    expect(run(s, { type: "SCENE_RENAME", id: "a", name: "Main", at: 1 })).toBe(s);
    const title = run(s, { type: "SCENE_RENAME", id: idOf(s, "Main"), name: "Title", at: 1 });
    expect(names(title)).toEqual(["Title", "Level"]);
    expect(savedProjectOf(title).sceneName).toBe("Title");
  });

  it("makes another scene the start: it becomes project.scene, and the game starts there", () => {
    const s = twoScenes();
    const started = run(s, { type: "SCENE_SET_START", id: "a" });
    expect(entries(started).map((e) => [e.name, e.isStart])).toEqual([["Level", true], ["Main", false]]);
    expect(savedProjectOf(started).scene.name).toBe("Level");
    expect(run(started, { type: "SCENE_SET_START", id: "a" })).toBe(started);
  });

  it("duplicates a scene with new node ids, next to the original, and opens the copy", () => {
    const s = run(twoScenes(), { type: "ADD_NODE", kind: "Sprite2D" });
    const copied = run(s, { type: "SCENE_DUPLICATE", id: "a", newId: "b" });
    expect(names(copied)).toEqual(["Main", "Level", "Level2"]);
    expect(copied.activeSceneId).toBe("b");
    expect(copied.sceneRoot.children).toHaveLength(1);
    expect(copied.sceneRoot.children[0].id).not.toBe(s.sceneRoot.children[0].id);
    expect(copied.sceneRoot.id).not.toBe(s.sceneRoot.id);
  });

  it("deletes a scene, never the last one; the start going hands the start to the first scene left, and the open scene going opens the start", () => {
    const s = twoScenes();
    const deleted = run(s, { type: "SCENE_DELETE", id: "a" });
    expect(names(deleted)).toEqual(["Main"]);
    expect(deleted.activeSceneId).toBe(idOf(s, "Main"));
    expect(run(deleted, { type: "SCENE_DELETE", id: idOf(deleted, "Main") })).toBe(deleted);
    const startGone = run(s, { type: "SCENE_DELETE", id: idOf(s, "Main") });
    expect(entries(startGone).map((e) => [e.name, e.isStart])).toEqual([["Level", true]]);
  });

  it("goes back to a plain one-scene project when the others are deleted", () => {
    const s = run(twoScenes(), { type: "SCENE_DELETE", id: "a" });
    const project = savedProjectOf(s);
    expect(project.scenes).toBeUndefined();
    expect(project.sceneName).toBeUndefined();
  });
});

describe("undoing scene edits", () => {
  it("undoes and redoes adding a scene, taking you back to the scene the edit started in", () => {
    const { state } = open();
    const added = run(state, { type: "SCENE_ADD", id: "a", name: "Level" });
    const undone = run(added, undo);
    expect(names(undone)).toEqual(["Main"]);
    expect(undone.activeSceneId).toBe(idOf(state, "Main"));
    expect(hasUnsavedChanges(undone)).toBe(false);
    const redone = run(undone, redo);
    expect(names(redone)).toEqual(["Main", "Level"]);
    expect(redone.activeSceneId).toBe("a");
  });

  it("undoes an edit made in another scene, opening that scene", () => {
    const { state } = open();
    const s = run(state, { type: "SCENE_ADD", id: "a", name: "Level" }, { type: "ADD_NODE", kind: "Sprite2D" }, { type: "SCENE_SWITCH", id: idOf(state, "Main") });
    const undone = run(s, undo);
    expect(undone.activeSceneId).toBe("a");
    expect(undone.sceneRoot.children).toHaveLength(0);
  });

  it("undoes a rename, a delete and a change of start", () => {
    const { state } = open();
    const s = run(state, { type: "SCENE_ADD", id: "a", name: "Level" }, { type: "SCENE_RENAME", id: "a", name: "Cave", at: 1 }, { type: "SCENE_SET_START", id: "a" }, { type: "SCENE_DELETE", id: idOf(state, "Main") });
    expect(names(s)).toEqual(["Cave"]);
    const back1 = run(s, undo);
    expect(entries(back1).map((e) => e.name)).toEqual(["Cave", "Main"]);
    const back2 = run(back1, undo);
    expect(entries(back2).map((e) => [e.name, e.isStart])).toEqual([["Main", true], ["Cave", false]]);
    expect(names(run(back2, undo))).toEqual(["Main", "Level"]);
  });
});

describe("saving several scenes", () => {
  it("writes the scene being edited into its own place, leaves the others as they were, and keeps assets any scene uses", () => {
    const { state } = open();
    const s = run(state, { type: "SCENE_ADD", id: "a", name: "Level" }, { type: "ADD_NODE", kind: "Sprite2D" });
    const saved = savedProjectOf(s);
    expect(saved.scenes).toHaveLength(1);
    expect(saved.scenes![0].scene.children.map((n) => n.kind)).toEqual(["Sprite2D"]);
    expect(saved.scene.children).toHaveLength(0);
    expect(findSceneNode(saved.scenes![0].scene, s.selectedNodeId)).toBeTruthy();
  });
});
