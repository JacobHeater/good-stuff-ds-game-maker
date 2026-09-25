import {
  createBlankSceneTree,
  createProjectSnapshot,
  encodeSamples,
  findSceneNode,
  getAudioPlayer,
  withUpdatedScene,
  type ImportedSound
} from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(mode: "2D" | "3D" = "3D"): EditorState {
  const project = createProjectSnapshot({ name: "P", mode, scene: createBlankSceneTree(mode) });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const sound = (id: string, samples = 8000): ImportedSound => ({ id, name: `beep-${id}`, sampleRate: 8000, samples: encodeSamples(new Int16Array(samples)) });
const importNew = (state: EditorState, s: ImportedSound, warnings: string[] = []): EditorState =>
  run(state, { type: "IMPORT_SOUND", nodeId: null, sound: s, warnings });
const withPlayer = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "AudioStreamPlayer" });
  return { state, id: state.selectedNodeId };
};
const audioOf = (s: EditorState, id: string) => getAudioPlayer(findSceneNode(s.sceneRoot, id)!);
const change = (id: string, c: Extract<Action, { type: "SET_AUDIO_PLAYER" }>["change"], at = 0): Action => ({ type: "SET_AUDIO_PLAYER", id, change: c, at });

describe("importing a sound as a new player", () => {
  it("adds the sound to the project and a new AudioStreamPlayer under the selected node, using it with the defaults", () => {
    const state = importNew(openProject(), sound("a"));
    expect(state.project!.sounds).toHaveLength(1);
    const node = findSceneNode(state.sceneRoot, state.selectedNodeId)!;
    expect(node).toMatchObject({ kind: "AudioStreamPlayer", name: "beep-a" });
    expect(node.audio).toEqual({ soundId: "a", autoplay: true, volume: 1, pitch: 1, loop: false });
    expect(state.sceneRoot.children).toHaveLength(1);
    expect(hasUnsavedChanges(state)).toBe(true);
  });

  it("works in a 2D project too, and names players uniquely", () => {
    let state = importNew(openProject("2D"), { ...sound("a"), name: "beep" });
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id });
    state = importNew(state, { ...sound("b"), name: "beep" });
    expect(state.sceneRoot.children.map((c) => c.name)).toEqual(["beep", "beep2"]);
  });

  it("logs the length, rate and size, and each warning", () => {
    const state = importNew(openProject(), sound("a", 16000), ["It has 2 channels; the DS plays one, so they were mixed together."]);
    expect(state.outputLog.at(-2)).toBe('Imported sound "beep-a" (0:02, 8000 Hz, 32000 bytes of sound memory) as node "beep-a".');
    expect(state.outputLog.at(-1)).toBe("Warning: It has 2 channels; the DS plays one, so they were mixed together.");
  });

  it("does nothing with no project open", () => {
    const state = createInitialState();
    expect(editorReducer(state, { type: "IMPORT_SOUND", nodeId: null, sound: sound("a"), warnings: [] })).toBe(state);
  });

  it("undoes and redoes as one step: the sound and the player go and come back together", () => {
    const before = openProject();
    const imported = importNew(before, sound("a"));
    expect(imported.history.past.at(-1)!.label).toBe("Import sound beep-a");
    const undone = run(imported, { type: "UNDO" });
    expect(undone.project!.sounds).toBeUndefined();
    expect(undone.sceneRoot).toBe(before.sceneRoot);
    expect(hasUnsavedChanges(undone)).toBe(false);
    const redone = run(undone, { type: "REDO" });
    expect(redone.project!.sounds).toEqual([sound("a")]);
    expect(findSceneNode(redone.sceneRoot, imported.selectedNodeId)?.audio?.soundId).toBe("a");
  });
});

describe("importing a sound onto a player", () => {
  it("adds the sound and assigns it to that player, keeping its settings, without adding a node", () => {
    const { state, id } = withPlayer();
    const tuned = run(state, change(id, { volume: 0.4, pitch: 2, loop: true, autoplay: false }));
    const imported = run(tuned, { type: "IMPORT_SOUND", nodeId: id, sound: sound("a"), warnings: [] });
    expect(imported.sceneRoot.children).toHaveLength(1);
    expect(audioOf(imported, id)).toEqual({ soundId: "a", autoplay: false, volume: 0.4, pitch: 2, loop: true });
    expect(imported.outputLog.at(-1)).toContain('onto "AudioStreamPlayer"');
    expect(run(imported, { type: "UNDO" }).project!.sounds).toBeUndefined();
  });

  it("makes a new player instead when the node isn't an audio player", () => {
    const state = run(openProject(), { type: "ADD_NODE", kind: "Camera3D" });
    const imported = run(state, { type: "IMPORT_SOUND", nodeId: state.selectedNodeId, sound: sound("a"), warnings: [] });
    // Like an imported model, it goes under the selected node.
    expect(imported.sceneRoot.children.map((c) => c.kind)).toEqual(["Camera3D"]);
    expect(imported.sceneRoot.children[0].children.map((c) => c.kind)).toEqual(["AudioStreamPlayer"]);
  });
});

describe("choosing a player's sound", () => {
  it("chooses one of the project's sounds and clears it, undoably", () => {
    const { state, id } = withPlayer();
    const withSounds = { ...state, project: { ...state.project!, sounds: [sound("a"), sound("b")] } };
    const chosen = run(withSounds, { type: "SET_AUDIO_SOUND", id, soundId: "b" });
    expect(audioOf(chosen, id).soundId).toBe("b");
    expect(chosen.history.past.at(-1)!.label).toBe("Change sound of AudioStreamPlayer");
    const cleared = run(chosen, { type: "SET_AUDIO_SOUND", id, soundId: null });
    expect(audioOf(cleared, id).soundId).toBeUndefined();
    expect(audioOf(run(cleared, { type: "UNDO" }), id).soundId).toBe("b");
  });

  it("refuses a sound the project doesn't have, and choosing what is chosen isn't an edit", () => {
    const { state, id } = withPlayer();
    expect(run(state, { type: "SET_AUDIO_SOUND", id, soundId: "nope" })).toBe(state);
    expect(run(state, { type: "SET_AUDIO_SOUND", id, soundId: null })).toBe(state);
    const withSounds = { ...state, project: { ...state.project!, sounds: [sound("a")] } };
    const chosen = run(withSounds, { type: "SET_AUDIO_SOUND", id, soundId: "a" });
    expect(run(chosen, { type: "SET_AUDIO_SOUND", id, soundId: "a" })).toBe(chosen);
  });

  it("only works on audio players", () => {
    const state = run(openProject(), { type: "ADD_NODE", kind: "Camera3D" });
    const withSounds = { ...state, project: { ...state.project!, sounds: [sound("a")] } };
    expect(run(withSounds, { type: "SET_AUDIO_SOUND", id: state.selectedNodeId, soundId: "a" })).toBe(withSounds);
    expect(run(withSounds, change(state.selectedNodeId, { volume: 0.2 }))).toBe(withSounds);
  });
});

describe("audio player settings", () => {
  it("starts with autoplay on, full volume, normal pitch and no loop, saving nothing for it", () => {
    const { state, id } = withPlayer();
    expect(audioOf(state, id)).toEqual({ autoplay: true, volume: 1, pitch: 1, loop: false });
    expect(findSceneNode(state.sceneRoot, id)!.audio).toBeUndefined();
  });

  it("sets each setting, and a checkbox change is one step each", () => {
    const { state, id } = withPlayer();
    let s = run(state, change(id, { autoplay: false }), change(id, { loop: true }), change(id, { loop: false }));
    expect(audioOf(s, id)).toMatchObject({ autoplay: false, loop: false });
    expect(s.history.past.map((e) => e.label)).toEqual(["Add AudioStreamPlayer", "Turn autoplay off for AudioStreamPlayer", "Turn loop on for AudioStreamPlayer", "Turn loop off for AudioStreamPlayer"]);
    s = run(s, { type: "UNDO" });
    expect(audioOf(s, id).loop).toBe(true);
  });

  it("clamps volume to 0..1 and pitch to 0.25..4, and ignores what isn't a number", () => {
    const { state, id } = withPlayer();
    expect(audioOf(run(state, change(id, { volume: 5 })), id).volume).toBe(1);
    expect(audioOf(run(state, change(id, { volume: -5 })), id).volume).toBe(0);
    expect(audioOf(run(state, change(id, { pitch: 100 })), id).pitch).toBe(4);
    expect(audioOf(run(state, change(id, { pitch: 0 })), id).pitch).toBe(0.25);
    expect(run(state, change(id, { volume: Number.NaN, pitch: Number.POSITIVE_INFINITY }))).toBe(state);
  });

  it("makes a slider drag one undo step, and two drags two", () => {
    const { state, id } = withPlayer();
    let s = run(state, change(id, { volume: 0.9 }, 1000), change(id, { volume: 0.7 }, 1030), change(id, { volume: 0.5 }, 1060));
    expect(s.history.past).toHaveLength(2); // the add, and one merged drag
    expect(audioOf(run(s, { type: "UNDO" }), id).volume).toBe(1);
    s = run(s, { type: "END_EDIT_GESTURE" }, change(id, { volume: 0.2 }, 1100));
    expect(s.history.past).toHaveLength(3);
    expect(audioOf(run(s, { type: "UNDO" }), id).volume).toBe(0.5);
  });

  it("keeps volume and pitch drags apart, and different players apart", () => {
    const { state, id } = withPlayer();
    const s = run(state, change(id, { volume: 0.9 }, 1000), change(id, { pitch: 2 }, 1020));
    expect(s.history.past.map((e) => e.label)).toEqual(["Add AudioStreamPlayer", "Change volume of AudioStreamPlayer", "Change pitch of AudioStreamPlayer"]);
  });

  it("isn't an edit to set a value to what it already is", () => {
    const { state, id } = withPlayer();
    expect(run(state, change(id, { volume: 1, pitch: 1, autoplay: true, loop: false }))).toBe(state);
    expect(hasUnsavedChanges(run(state, change(id, {})))).toBe(hasUnsavedChanges(state));
  });
});

describe("sounds and saving", () => {
  it("saves what players use, once, and forgets what nothing uses", () => {
    let state = importNew(openProject(), sound("a"));
    state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id });
    state = importNew(state, sound("b"));
    const first = state.sceneRoot.children[0].id;
    state = run(state, { type: "DUPLICATE_NODE", id: first }); // shares sound "a"
    expect(state.sceneRoot.children.filter((c) => c.audio?.soundId === "a")).toHaveLength(2);
    expect(withUpdatedScene(state.project!, state.sceneRoot).sounds!.map((s) => s.id)).toEqual(["a", "b"]);
    const idOf = (soundId: string): string[] => state.sceneRoot.children.filter((c) => c.audio?.soundId === soundId).map((c) => c.id);
    const deletedB = run(state, { type: "DELETE_NODE", id: idOf("b")[0] });
    expect(withUpdatedScene(deletedB.project!, deletedB.sceneRoot).sounds!.map((s) => s.id)).toEqual(["a"]);
    const allGone = run(deletedB, ...idOf("a").map((id): Action => ({ type: "DELETE_NODE", id })));
    expect("sounds" in withUpdatedScene(allGone.project!, allGone.sceneRoot)).toBe(false);
  });
});
