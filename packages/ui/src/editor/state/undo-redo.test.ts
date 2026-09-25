import {
  createBlankSceneTree,
  createProjectSnapshot,
  findSceneNode,
  flattenSceneTree,
  parseObj,
  withUpdatedScene,
  type ImportedMesh,
  type ProjectSnapshot
} from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

/** Runs actions through the real reducer, one after another. */
function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function openProject(mode: "2D" | "3D" = "3D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
/** What the save flow does: the snapshot is the editor's current scene, and it becomes the project. */
function save(state: EditorState): EditorState {
  return editorReducer(state, { type: "PROJECT_SAVED", filePath: "p.gsds", project: withUpdatedScene(state.project!, state.sceneRoot) });
}
const names = (state: EditorState): string[] => flattenSceneTree(state.sceneRoot).map((n) => n.name);
const add = (kind: "MeshInstance3D" | "Camera3D" | "Node3D" = "MeshInstance3D"): Action => ({ type: "ADD_NODE", kind });
const undo: Action = { type: "UNDO" };
const redo: Action = { type: "REDO" };
const setPos = (id: string, x: number, at: number): Action => ({ type: "SET_TRANSFORM_3D", id, field: "position", value: { x, y: 0, z: 0 }, at });
const selectedId = (s: EditorState): string => s.selectedNodeId;

describe("undo and redo of scene edits", () => {
  it("undoes an added node, redoes it, and restores the selection each time", () => {
    const opened = openProject();
    const added = run(opened, add());
    expect(names(added)).toEqual(["Main", "MeshInstance3D"]);
    const newId = selectedId(added);
    expect(newId).not.toBe(opened.sceneRoot.id);

    const undone = run(added, undo);
    expect(names(undone)).toEqual(["Main"]);
    expect(undone.sceneRoot).toBe(opened.sceneRoot); // the very same tree, not a copy
    expect(selectedId(undone)).toBe(opened.sceneRoot.id);

    const redone = run(undone, redo);
    expect(redone.sceneRoot).toBe(added.sceneRoot);
    expect(selectedId(redone)).toBe(newId);
  });

  it("brings a deleted node back and selects it", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const deleted = run(withNode, { type: "DELETE_NODE", id });
    expect(names(deleted)).toEqual(["Main"]);
    const undone = run(deleted, undo);
    expect(findSceneNode(undone.sceneRoot, id)).toBeDefined();
    expect(selectedId(undone)).toBe(id);
  });

  it("undoes a duplicate, a visibility toggle and a mesh change", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const dup = run(withNode, { type: "DUPLICATE_NODE", id });
    expect(names(run(dup, undo))).toEqual(names(withNode));

    const hidden = run(withNode, { type: "TOGGLE_VISIBLE", id });
    expect(findSceneNode(run(hidden, undo).sceneRoot, id)!.visible).toBe(true);

    const sphere = run(withNode, { type: "SET_MESH_SOURCE", id, source: { primitive: "sphere" } });
    expect(findSceneNode(sphere.sceneRoot, id)!.mesh!.primitive).toBe("sphere");
    expect(findSceneNode(run(sphere, undo).sceneRoot, id)!.mesh!.primitive).toBe("cube");
  });

  it("undoes several edits in reverse order and redoes them forward", () => {
    let s = openProject();
    s = run(s, add(), add("Camera3D"), add("Node3D"));
    expect(names(s)).toHaveLength(4);
    s = run(s, undo);
    expect(names(s)).toHaveLength(3);
    s = run(s, undo, undo);
    expect(names(s)).toEqual(["Main"]);
    s = run(s, undo); // nothing left: harmless
    expect(names(s)).toEqual(["Main"]);
    s = run(s, redo, redo, redo, redo);
    expect(names(s)).toHaveLength(4);
  });

  it("clears the redo stack on a new edit", () => {
    let s = run(openProject(), add(), add("Camera3D"));
    s = run(s, undo);
    expect(s.history.future).toHaveLength(1);
    s = run(s, add("Node3D"));
    expect(s.history.future).toEqual([]);
    expect(run(s, redo)).toBe(s); // nothing to redo: the very same state
  });

  it("logs what it undid and redid", () => {
    const s = run(openProject(), add(), undo, redo);
    expect(s.outputLog.slice(-2)).toEqual(["Undid: Add MeshInstance3D.", "Redid: Add MeshInstance3D."]);
  });
});

describe("what counts as one step", () => {
  it("merges typing into one field into one step, and one undo restores the value from before", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const typed = run(withNode, setPos(id, 1, 1000), setPos(id, 12, 1200), setPos(id, 12.5, 1400));
    expect(typed.history.past).toHaveLength(2); // the add, and one merged move
    const undone = run(typed, undo);
    expect(undone.sceneRoot).toBe(withNode.sceneRoot);
    expect(findSceneNode(undone.sceneRoot, id)!.transform3D!.position.x).toBe(0);
    expect(run(undone, redo).sceneRoot).toBe(typed.sceneRoot);
  });

  it("keeps different fields, different nodes and pauses as separate steps", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const rot: Action = { type: "SET_TRANSFORM_3D", id, field: "rotation", value: { x: 0, y: 45, z: 0 }, at: 1100 };
    expect(run(withNode, setPos(id, 1, 1000), rot).history.past).toHaveLength(3);
    expect(run(withNode, setPos(id, 1, 1000), setPos(id, 2, 3000)).history.past).toHaveLength(3);
  });

  it("makes two quick drags two steps when the gesture ends between them", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const s = run(withNode, setPos(id, 1, 1000), setPos(id, 2, 1010), { type: "END_EDIT_GESTURE" }, setPos(id, 3, 1020), setPos(id, 4, 1030));
    expect(s.history.past).toHaveLength(3);
    const once = run(s, undo);
    expect(findSceneNode(once.sceneRoot, id)!.transform3D!.position.x).toBe(2); // only the second drag is undone
    expect(findSceneNode(run(once, undo).sceneRoot, id)!.transform3D!.position.x).toBe(0);
  });

  it("merges 2D marker drags the same way", () => {
    const withNode = run(openProject("2D"), { type: "ADD_NODE", kind: "Sprite2D" });
    const id = selectedId(withNode);
    const start = findSceneNode(withNode.sceneRoot, id)!.position;
    const dragged = run(
      withNode,
      { type: "MOVE_NODE", id, x: 5, y: 5, at: 100 },
      { type: "MOVE_NODE", id, x: 9, y: 9, at: 130 },
      { type: "MOVE_NODE", id, x: 20, y: 30, at: 160 }
    );
    expect(dragged.history.past).toHaveLength(2);
    expect(findSceneNode(run(dragged, undo).sceneRoot, id)!.position).toEqual(start);
  });

  it("doesn't make a step, or an unsaved change, out of an edit that changes nothing", () => {
    const withNode = run(openProject(), add());
    const id = selectedId(withNode);
    const sameMove = run(withNode, setPos(id, 0, 5000));
    expect(sameMove).toBe(withNode);
    const sameMesh = run(withNode, { type: "SET_MESH_SOURCE", id, source: { primitive: "cube" } });
    expect(sameMesh).toBe(withNode);
    const sameMarker = run(openProject("2D"), { type: "MOVE_NODE", id: "nope", x: 1, y: 1, at: 0 });
    expect(sameMarker.history.past).toEqual([]);
    const s2d = run(openProject("2D"), { type: "ADD_NODE", kind: "Sprite2D" });
    const at = findSceneNode(s2d.sceneRoot, selectedId(s2d))!.position;
    expect(run(s2d, { type: "MOVE_NODE", id: selectedId(s2d), x: at.x, y: at.y, at: 0 })).toBe(s2d);
  });

  it("leaves view settings and file operations out of the history", () => {
    const opened = openProject();
    const s = run(
      opened,
      { type: "SET_TOOL", tool: "move" },
      { type: "SET_SCREEN_FILTER", filter: "bottom" },
      { type: "SET_FPS_TARGET", fps: 30 },
      { type: "SET_BOTTOM_TAB", tab: "Hardware" },
      { type: "SELECT_NODE", id: opened.sceneRoot.id }
    );
    expect(s.history).toEqual(opened.history);
    const undone = run(s, undo);
    expect(undone.activeTool).toBe("move"); // nothing was undone
    expect(undone.screenFilter).toBe("bottom");
    expect(undone.fpsTarget).toBe(30);
  });
});

describe("history and the project file", () => {
  it("reads as clean after undoing back to the saved tree, and dirty again after redoing", () => {
    let s = run(openProject(), add());
    expect(hasUnsavedChanges(s)).toBe(true);
    s = save(s);
    expect(hasUnsavedChanges(s)).toBe(false);
    s = run(s, add("Camera3D"));
    expect(hasUnsavedChanges(s)).toBe(true);
    s = run(s, undo);
    expect(hasUnsavedChanges(s)).toBe(false); // the very tree that was saved
    s = run(s, redo);
    expect(hasUnsavedChanges(s)).toBe(true);
  });

  it("keeps history across a save, so undoing past it makes the project dirty", () => {
    let s = save(run(openProject(), add()));
    expect(s.history.past).toHaveLength(1);
    s = run(s, undo);
    expect(names(s)).toEqual(["Main"]);
    expect(hasUnsavedChanges(s)).toBe(true);
  });

  it("starts a fresh history when a project is opened, created or closed, and never carries edits across", () => {
    const edited = run(openProject(), add(), add("Camera3D"));
    expect(edited.history.past).toHaveLength(2);
    const other: ProjectSnapshot = createProjectSnapshot({ name: "Other", mode: "3D", scene: createBlankSceneTree("3D") });
    const reopened = run(edited, { type: "PROJECT_OPENED", filePath: "o.gsds", project: other });
    expect(reopened.history.past).toEqual([]);
    expect(run(reopened, undo)).toBe(reopened);
    expect(names(run(reopened, undo))).toEqual(["Main"]);
    expect(run(edited, { type: "PROJECT_CLOSED" }).history.past).toEqual([]);
    expect(run(edited, { type: "PROJECT_CREATED", filePath: "n.gsds", project: other }).history.past).toEqual([]);
  });

  it("does nothing on the startup view, where no project is open", () => {
    const startup = createInitialState();
    expect(run(startup, undo)).toBe(startup);
    expect(run(startup, redo)).toBe(startup);
  });
});

describe("imported models are part of the undo step", () => {
  const parsed = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", { name: "tri" });
  if (!parsed.ok) throw new Error("fixture didn't parse");
  const mesh: ImportedMesh = { id: "m1", ...parsed.mesh };

  it("takes the model out of the project and the node out of the scene, and puts both back on redo", () => {
    const opened = openProject();
    const imported = run(opened, { type: "IMPORT_MESH", mesh, warnings: [] });
    expect(imported.project!.meshes).toEqual([mesh]);
    expect(names(imported)).toEqual(["Main", "tri"]);

    const undone = run(imported, undo);
    expect(names(undone)).toEqual(["Main"]);
    expect("meshes" in undone.project!).toBe(false); // no leftover key, so saving writes an identical file
    expect(undone.project!.scene).toBe(opened.project!.scene);

    const redone = run(undone, redo);
    expect(redone.project!.meshes).toEqual([mesh]);
    expect(names(redone)).toEqual(["Main", "tri"]);
  });

  it("falls back to the scene root when the selection no longer exists after undoing", () => {
    const s = run(openProject(), { type: "IMPORT_MESH", mesh, warnings: [] }, undo);
    expect(selectedId(s)).toBe(s.sceneRoot.id);
  });
});
