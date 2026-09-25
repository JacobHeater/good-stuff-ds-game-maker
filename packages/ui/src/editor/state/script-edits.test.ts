import { createBlankSceneTree, createProjectSnapshot, findSceneNode, flattenSceneTree, NEW_SCRIPT_SOURCE, withUpdatedScene } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(mode: "2D" | "3D" = "3D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const create = (id: string, attachTo: string | null = null): Action => ({ type: "CREATE_SCRIPT", id, attachTo });
const withNode = (kind: "MeshInstance3D" | "Camera3D" = "MeshInstance3D"): { state: EditorState; nodeId: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind });
  return { state, nodeId: state.selectedNodeId };
};
const scripts = (s: EditorState) => s.project!.scripts ?? [];
const scriptOf = (s: EditorState, nodeId: string) => findSceneNode(s.sceneRoot, nodeId)!.scriptId;

describe("creating scripts", () => {
  it("adds a script with the starter stubs, opens it, and is an unsaved change", () => {
    const state = run(openProject(), create("s1"));
    expect(scripts(state)).toEqual([{ id: "s1", name: "Script", source: NEW_SCRIPT_SOURCE }]);
    expect(state.selectedScriptId).toBe("s1");
    expect(hasUnsavedChanges(state)).toBe(true);
    expect(state.outputLog.at(-1)).toBe('Created script "Script".');
  });

  it("names new scripts Script, Script2, Script3", () => {
    const state = run(openProject(), create("a"), create("b"), create("c"));
    expect(scripts(state).map((s) => s.name)).toEqual(["Script", "Script2", "Script3"]);
  });

  it("can attach the new script to a node in the same step", () => {
    const { state, nodeId } = withNode();
    const made = run(state, create("s1", nodeId));
    expect(scriptOf(made, nodeId)).toBe("s1");
    expect(made.outputLog.at(-1)).toContain('attached it to "MeshInstance3D"');
    const undone = run(made, { type: "UNDO" });
    expect(scripts(undone)).toEqual([]);
    expect(scriptOf(undone, nodeId)).toBeUndefined();
    expect(undone.selectedScriptId).toBeNull();
    expect(undone.sceneRoot).toBe(state.sceneRoot); // exactly as it was before the script was created
  });

  it("works in a 2D project too, and does nothing with no project open", () => {
    expect(scripts(run(openProject("2D"), create("s1")))).toHaveLength(1);
    const closed = createInitialState();
    expect(editorReducer(closed, create("s1"))).toBe(closed);
  });
});

describe("editing a script's source", () => {
  it("replaces the text, is an unsaved change, and undoing back to the saved text reads as clean", () => {
    const base = run(openProject(), create("s1"));
    const saved = { ...base, savedScripts: base.project!.scripts, project: { ...base.project!, scene: base.sceneRoot } }; // as if just saved
    expect(hasUnsavedChanges(saved)).toBe(false);
    const edited = run(saved, { type: "SET_SCRIPT_SOURCE", id: "s1", source: "func _ready():\n    pass\n", at: 0 });
    expect(scripts(edited)[0].source).toBe("func _ready():\n    pass\n");
    expect(hasUnsavedChanges(edited)).toBe(true);
    const undone = run(edited, { type: "UNDO" });
    expect(scripts(undone)[0].source).toBe(NEW_SCRIPT_SOURCE);
    expect(hasUnsavedChanges(undone)).toBe(false);
    expect(hasUnsavedChanges(run(undone, { type: "REDO" }))).toBe(true);
  });

  it("merges typing into one undo step per pause, and a pause starts a new one", () => {
    let state = run(openProject(), create("s1"));
    const before = state.history.past.length;
    for (let i = 0; i < 20; i++) state = run(state, { type: "SET_SCRIPT_SOURCE", id: "s1", source: `x${i}`, at: 1000 + i * 40 });
    expect(state.history.past).toHaveLength(before + 1);
    expect(state.history.past.at(-1)!.label).toBe("Edit Script");
    state = run(state, { type: "SET_SCRIPT_SOURCE", id: "s1", source: "later", at: 5000 });
    expect(state.history.past).toHaveLength(before + 2);
    expect(scripts(run(state, { type: "UNDO" }))[0].source).toBe("x19");
  });

  it("isn't an edit to set the same text, or to edit a script that doesn't exist", () => {
    const state = run(openProject(), create("s1"));
    expect(run(state, { type: "SET_SCRIPT_SOURCE", id: "s1", source: NEW_SCRIPT_SOURCE, at: 0 })).toBe(state);
    expect(run(state, { type: "SET_SCRIPT_SOURCE", id: "nope", source: "x", at: 0 })).toBe(state);
  });

  it("keeps a script's text exactly, including tabs, CRLF and non-ASCII", () => {
    const text = "# é\t\r\nfunc f():\n\treturn 1\n";
    const state = run(openProject(), create("s1"), { type: "SET_SCRIPT_SOURCE", id: "s1", source: text, at: 0 });
    expect(scripts(state)[0].source).toBe(text);
  });
});

describe("renaming", () => {
  it("renames (trimmed), ignores an empty name and the same name, and merges typing", () => {
    let state = run(openProject(), create("s1"));
    state = run(state, { type: "RENAME_SCRIPT", id: "s1", name: "  Player  ", at: 1000 });
    expect(scripts(state)[0].name).toBe("Player");
    expect(run(state, { type: "RENAME_SCRIPT", id: "s1", name: "   ", at: 1100 })).toBe(state);
    expect(run(state, { type: "RENAME_SCRIPT", id: "s1", name: "Player", at: 1100 })).toBe(state);
    const steps = state.history.past.length;
    // Typing within a second of the last rename joins that step (the window slides), so all of it undoes at once.
    state = run(state, { type: "RENAME_SCRIPT", id: "s1", name: "Playe", at: 1200 }, { type: "RENAME_SCRIPT", id: "s1", name: "Play", at: 1300 });
    expect(state.history.past).toHaveLength(steps);
    expect(scripts(state)[0].name).toBe("Play");
    expect(scripts(run(state, { type: "UNDO" }))[0].name).toBe("Script");
    // After a pause it is a new step.
    const later = run(state, { type: "RENAME_SCRIPT", id: "s1", name: "Hero", at: 9000 });
    expect(later.history.past).toHaveLength(steps + 1);
    expect(scripts(run(later, { type: "UNDO" }))[0].name).toBe("Play");
  });
});

describe("attaching", () => {
  it("attaches and detaches, undoably, and refuses a script the project doesn't have", () => {
    const { state, nodeId } = withNode();
    const made = run(state, create("s1"));
    const attached = run(made, { type: "ATTACH_SCRIPT", nodeId, scriptId: "s1" });
    expect(scriptOf(attached, nodeId)).toBe("s1");
    expect(attached.history.past.at(-1)!.label).toBe("Attach script to MeshInstance3D");
    const detached = run(attached, { type: "ATTACH_SCRIPT", nodeId, scriptId: null });
    expect(scriptOf(detached, nodeId)).toBeUndefined();
    expect("scriptId" in findSceneNode(detached.sceneRoot, nodeId)!).toBe(false);
    expect(detached.history.past.at(-1)!.label).toBe("Detach script from MeshInstance3D");
    expect(scriptOf(run(detached, { type: "UNDO" }), nodeId)).toBe("s1");
    expect(run(made, { type: "ATTACH_SCRIPT", nodeId, scriptId: "nope" })).toBe(made);
    expect(run(attached, { type: "ATTACH_SCRIPT", nodeId, scriptId: "s1" })).toBe(attached); // already attached
  });

  it("attaches to any kind of node, and a duplicate keeps the attachment", () => {
    const { state, nodeId } = withNode("Camera3D");
    const attached = run(state, create("s1", nodeId), { type: "DUPLICATE_NODE", id: nodeId });
    expect(flattenSceneTree(attached.sceneRoot).filter((n) => n.scriptId === "s1")).toHaveLength(2);
  });
});

describe("deleting", () => {
  it("removes the script and detaches every node that used it, and one undo brings all of it back", () => {
    let state = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
    const a = state.selectedNodeId;
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id }, { type: "ADD_NODE", kind: "Camera3D" });
    const b = state.selectedNodeId;
    state = run(state, create("s1"), create("s2"), { type: "ATTACH_SCRIPT", nodeId: a, scriptId: "s1" }, { type: "ATTACH_SCRIPT", nodeId: b, scriptId: "s1" });
    const deleted = run(state, { type: "DELETE_SCRIPT", id: "s1" });
    expect(scripts(deleted).map((s) => s.id)).toEqual(["s2"]);
    expect(scriptOf(deleted, a)).toBeUndefined();
    expect(scriptOf(deleted, b)).toBeUndefined();
    expect(deleted.selectedScriptId).toBe("s2");
    const undone = run(deleted, { type: "UNDO" });
    expect(scripts(undone).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect([scriptOf(undone, a), scriptOf(undone, b)]).toEqual(["s1", "s1"]);
  });

  it("leaves untouched branches of the tree as they were (same objects)", () => {
    let state = run(openProject(), { type: "ADD_NODE", kind: "Node3D" }, create("s1"));
    const group = state.selectedNodeId;
    state = run(state, { type: "ADD_NODE", kind: "MeshInstance3D" });
    const before = findSceneNode(state.sceneRoot, group)!;
    const deleted = run(state, { type: "DELETE_SCRIPT", id: "s1" });
    expect(findSceneNode(deleted.sceneRoot, group)).toBe(before);
  });

  it("deleting the last script leaves a project with no scripts key at all", () => {
    const state = run(openProject(), create("s1"), { type: "DELETE_SCRIPT", id: "s1" });
    expect("scripts" in state.project!).toBe(false);
    expect(state.selectedScriptId).toBeNull();
    expect(run(state, { type: "DELETE_SCRIPT", id: "s1" })).toBe(state);
  });
});

describe("scripts and saving", () => {
  it("keeps every script when the scene is saved, attached or not", () => {
    const state = run(openProject(), create("s1"), create("s2"));
    expect(withUpdatedScene(state.project!, state.sceneRoot).scripts!.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("selecting a script isn't an edit", () => {
    const state = run(openProject(), create("s1"), create("s2"));
    const steps = state.history.past.length;
    const selected = run(state, { type: "SELECT_SCRIPT", id: "s1" });
    expect(selected.selectedScriptId).toBe("s1");
    expect(selected.history.past).toHaveLength(steps);
    expect(run(selected, { type: "SELECT_SCRIPT", id: "s1" })).toBe(selected);
  });

  it("opening a project selects its first script, and saving clears the unsaved mark", () => {
    const base = run(openProject(), create("s1"), create("s2"));
    const snapshot = withUpdatedScene(base.project!, base.sceneRoot);
    const reopened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project: snapshot });
    expect(reopened.selectedScriptId).toBe("s1");
    expect(hasUnsavedChanges(reopened)).toBe(false);
    const edited = run(reopened, { type: "SET_SCRIPT_SOURCE", id: "s1", source: "x", at: 0 });
    expect(hasUnsavedChanges(edited)).toBe(true);
    const saved = editorReducer(edited, { type: "PROJECT_SAVED", filePath: "p.gsds", project: withUpdatedScene(edited.project!, edited.sceneRoot) });
    expect(hasUnsavedChanges(saved)).toBe(false);
    expect(hasUnsavedChanges(run(saved, { type: "UNDO" }))).toBe(true); // undoing past a save reads as unsaved, as for the scene
  });
});
