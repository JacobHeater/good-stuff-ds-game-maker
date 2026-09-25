import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getAnimationPlayer, type AnimationProperty } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

/** requirements/animation/TASK.animation-timeline-editor.md (the state behind the Animation panel) */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);

interface World {
  state: EditorState;
  player: string;
  cube: string;
  sound: string;
}
function world(): World {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  let state = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  state = run(state, { type: "ADD_NODE", kind: "AnimationPlayer" });
  const player = state.selectedNodeId;
  state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id }, { type: "ADD_NODE", kind: "MeshInstance3D" });
  const cube = state.selectedNodeId;
  state = run(state, { type: "SELECT_NODE", id: state.sceneRoot.id }, { type: "ADD_NODE", kind: "AudioStreamPlayer" });
  const sound = state.selectedNodeId;
  return { state: run(state, { type: "SELECT_NODE", id: player }), player, cube, sound };
}
const animationsOf = (state: EditorState, player: string) => getAnimationPlayer(findSceneNode(state.sceneRoot, player)!);
const create = (player: string, id: string): Action => ({ type: "ANIM_CREATE", playerId: player, id });
const addTrack = (w: World, animationId: string, trackId: string, property: AnimationProperty = "position", nodeId = w.cube): Action => ({ type: "ANIM_ADD_TRACK", playerId: w.player, animationId, trackId, nodeId, property });
const addKey = (w: World, animationId: string, trackId: string, time: number): Action => ({ type: "ANIM_ADD_KEY", playerId: w.player, animationId, trackId, time });
const moveCube = (w: World, x: number): Action => ({ type: "SET_TRANSFORM_3D", id: w.cube, field: "position", value: { x, y: 0, z: 0 }, at: 0 } as unknown as Action);

describe("animations of an AnimationPlayer", () => {
  it("starts with none, and a new one is named Animation, is 1 s long, doesn't loop and is selected", () => {
    const w = world();
    expect(animationsOf(w.state, w.player).animations).toEqual([]);
    const made = run(w.state, create(w.player, "a1"), create(w.player, "a2"));
    expect(animationsOf(made, w.player).animations.map((a) => [a.id, a.name, a.length, a.loop, a.tracks])).toEqual([["a1", "Animation", 1, false, []], ["a2", "Animation2", 1, false, []]]);
    expect(made.animationUi.animationId).toBe("a2");
    expect(hasUnsavedChanges(made)).toBe(true);
    expect(run(made, { type: "UNDO" }, { type: "UNDO" }).sceneRoot).toBe(w.state.sceneRoot);
  });

  it("only applies to an AnimationPlayer", () => {
    const w = world();
    expect(run(w.state, create(w.cube, "a1"))).toBe(w.state);
    expect(run(w.state, create("missing", "a1"))).toBe(w.state);
  });

  it("renames (trimmed), and ignores an empty name, the same name, and a name another animation has", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), create(w.player, "a2"));
    const rename = (name: string, id = "a1", at = 0): Action => ({ type: "ANIM_RENAME", playerId: w.player, animationId: id, name, at });
    expect(animationsOf(run(s, rename("  walk  ")), w.player).animations[0].name).toBe("walk");
    expect(run(s, rename(""))).toBe(s);
    expect(run(s, rename("Animation"))).toBe(s);
    expect(run(s, rename("Animation2"))).toBe(s);
    expect(run(s, rename("x", "missing"))).toBe(s);
    // Typing merges into one step.
    let typed = s;
    for (const [i, t] of ["w", "wa", "wal", "walk"].entries()) typed = run(typed, rename(t, "a1", 1000 + i * 50));
    expect(typed.history.past.length).toBe(s.history.past.length + 1);
  });

  it("deletes one, clears the autoplay that named it, and undoes", () => {
    const w = world();
    let s = run(w.state, create(w.player, "a1"), create(w.player, "a2"), { type: "ANIM_PLAYER_SET", playerId: w.player, change: { autoplay: "a1" }, at: 0 });
    expect(animationsOf(s, w.player).autoplay).toBe("a1");
    const deleted = run(s, { type: "ANIM_DELETE", playerId: w.player, animationId: "a1" });
    expect(animationsOf(deleted, w.player).animations.map((a) => a.id)).toEqual(["a2"]);
    expect(animationsOf(deleted, w.player).autoplay).toBeUndefined();
    expect(deleted.animationUi.animationId).toBeNull();
    expect(deleted.animationUi.playerId).toBe(w.player);
    expect(animationsOf(run(deleted, { type: "UNDO" }), w.player).autoplay).toBe("a1");
    s = run(s, { type: "ANIM_DELETE", playerId: w.player, animationId: "a2" });
    expect(animationsOf(s, w.player).autoplay).toBe("a1"); // deleting another one leaves it
  });

  it("sets length and loop, keeps the length no shorter than the last key, and merges typing", () => {
    const w = world();
    let s = run(w.state, create(w.player, "a1"), addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0.8));
    const set = (change: { length?: number; loop?: boolean }, at = 0): Action => ({ type: "ANIM_SET", playerId: w.player, animationId: "a1", change, at });
    expect(animationsOf(run(s, set({ length: 3 })), w.player).animations[0].length).toBe(3);
    expect(animationsOf(run(s, set({ length: 0.2 })), w.player).animations[0].length).toBe(0.8); // not shorter than its last key
    expect(animationsOf(run(s, set({ length: 0 })), w.player).animations[0].length).toBe(0.8);
    expect(animationsOf(run(s, set({ length: 9999 })), w.player).animations[0].length).toBe(600);
    expect(run(s, set({ length: NaN }))).toBe(s);
    expect(run(s, set({ length: 1 }))).toBe(s); // what it already is
    expect(animationsOf(run(s, set({ loop: true })), w.player).animations[0].loop).toBe(true);
    const before = s.history.past.length;
    for (const [i, len] of [2, 2.5, 3].entries()) s = run(s, set({ length: len }, 5000 + i * 50));
    expect(s.history.past.length).toBe(before + 1);
  });

  it("sets autoplay (an animation of the player, or none) and speed (kept in range)", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"));
    const set = (change: { autoplay?: string | null; speed?: number }): Action => ({ type: "ANIM_PLAYER_SET", playerId: w.player, change, at: 0 });
    expect(animationsOf(run(s, set({ autoplay: "a1" })), w.player).autoplay).toBe("a1");
    expect(run(s, set({ autoplay: "nope" }))).toBe(s);
    expect(animationsOf(run(s, set({ autoplay: "a1" }), set({ autoplay: null })), w.player).autoplay).toBeUndefined();
    expect(animationsOf(run(s, set({ speed: 2 })), w.player).speed).toBe(2);
    expect(animationsOf(run(s, set({ speed: 0 })), w.player).speed).toBe(0.05);
    expect(animationsOf(run(s, set({ speed: 99 })), w.player).speed).toBe(10);
    expect(run(s, set({ speed: 1 }))).toBe(s);
  });
});

describe("tracks and keys", () => {
  const base = (): World & { s: EditorState } => {
    const w = world();
    return { ...w, s: run(w.state, create(w.player, "a1")) };
  };

  it("adds a track for a node and a property it has, selects it, and refuses a duplicate or a property the node can't have", () => {
    const { s, ...w } = base();
    const made = run(s, addTrack(w, "a1", "t1"));
    expect(animationsOf(made, w.player).animations[0].tracks).toEqual([{ id: "t1", nodeId: w.cube, property: "position", keys: [] }]);
    expect(made.animationUi.trackId).toBe("t1");
    expect(run(made, addTrack(w, "a1", "t2"))).toBe(made); // the same node and property
    expect(run(s, addTrack(w, "a1", "t3", "volume"))).toBe(s); // a mesh has no volume
    expect(run(s, addTrack(w, "a1", "t4", "pitch", w.sound)).sceneRoot).not.toBe(s.sceneRoot);
    expect(run(s, addTrack(w, "a1", "t5", "position", w.sound))).toBe(s); // a sound player has no position
    expect(run(s, addTrack(w, "a1", "t6", "position", "missing"))).toBe(s);
    expect(run(s, addTrack(w, "nope", "t7"))).toBe(s);
  });

  it("adds a key at a time with the node's current value, in time order, and selects it", () => {
    const { s, ...w } = base();
    let state = run(s, addTrack(w, "a1", "t1"), moveCube(w, 5));
    state = run(state, { type: "SET_TRANSFORM_3D", id: w.cube, field: "position", value: { x: -2, y: 0, z: 0 }, at: 0 } as unknown as Action);
    state = run(state, addKey(w, "a1", "t1", 0.5));
    state = run(state, { type: "SET_TRANSFORM_3D", id: w.cube, field: "position", value: { x: 2, y: 1, z: 0 }, at: 9000 } as unknown as Action);
    state = run(state, addKey(w, "a1", "t1", 0.25));
    const keys = animationsOf(state, w.player).animations[0].tracks[0].keys;
    expect(keys).toEqual([{ time: 0.25, value: { x: 2, y: 1, z: 0 } }, { time: 0.5, value: { x: -2, y: 0, z: 0 } }]);
    expect(state.animationUi.keyTime).toBe(0.25);
  });

  it("a key at a time that already has one takes the new value instead of adding a second", () => {
    const { s, ...w } = base();
    let state = run(s, addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0.5));
    state = run(state, { type: "SET_TRANSFORM_3D", id: w.cube, field: "position", value: { x: 3, y: 3, z: 3 }, at: 5000 } as unknown as Action, addKey(w, "a1", "t1", 0.5));
    const keys = animationsOf(state, w.player).animations[0].tracks[0].keys;
    expect(keys).toEqual([{ time: 0.5, value: { x: 3, y: 3, z: 3 } }]);
  });

  it("keeps a new key's time inside the animation and rounds it to a thousandth", () => {
    const { s, ...w } = base();
    const state = run(s, addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0.12349), addKey(w, "a1", "t1", 99), addKey(w, "a1", "t1", -3));
    expect(animationsOf(state, w.player).animations[0].tracks[0].keys.map((k) => k.time)).toEqual([0, 0.123, 1]);
  });

  it("takes a bool for a visible track and a number for a sound player's volume, from the node", () => {
    const { s, ...w } = base();
    let state = run(s, addTrack(w, "a1", "tv", "visible"), addKey(w, "a1", "tv", 0), { type: "TOGGLE_VISIBLE", id: w.cube } as unknown as Action, addKey(w, "a1", "tv", 1));
    expect(animationsOf(state, w.player).animations[0].tracks[0].keys.map((k) => k.value)).toEqual([true, false]);
    state = run(s, addTrack(w, "a1", "tw", "volume", w.sound), addKey(w, "a1", "tw", 0.5));
    expect(animationsOf(state, w.player).animations[0].tracks[0].keys[0].value).toBe(1); // the player's default volume
  });

  it("edits a key's value (checked for the property and clamped for volume) and its time (kept sorted, refused if another key has it)", () => {
    const { s, ...w } = base();
    const state = run(s, addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0), addKey(w, "a1", "t1", 0.5), addTrack(w, "a1", "t2", "volume", w.sound), addKey(w, "a1", "t2", 0));
    const setKey = (trackId: string, time: number, change: { time?: number; value?: never }, at = 0): Action => ({ type: "ANIM_SET_KEY", playerId: w.player, animationId: "a1", trackId, time, change, at });
    const keysOf = (st: EditorState, i: number) => animationsOf(st, w.player).animations[0].tracks[i].keys;
    const moved = run(state, setKey("t1", 0, { time: 0.75 }));
    expect(keysOf(moved, 0).map((k) => k.time)).toEqual([0.5, 0.75]);
    expect(moved.animationUi.keyTime).toBe(0.75);
    expect(run(state, setKey("t1", 0, { time: 0.5 }))).toBe(state); // another key has that time
    expect(keysOf(run(state, setKey("t1", 0, { time: 5 })), 0).map((k) => k.time)).toEqual([0.5, 1]); // clamped to the length
    expect(keysOf(run(state, setKey("t1", 0.5, { value: { x: 9, y: 8, z: 7 } as never })), 0)[1].value).toEqual({ x: 9, y: 8, z: 7 });
    expect(run(state, setKey("t1", 0.5, { value: 3 as never }))).toBe(state); // a number isn't a position
    expect(keysOf(run(state, setKey("t2", 0, { value: 5 as never })), 1)[0].value).toBe(1); // volume is clamped to 0..1
    expect(keysOf(run(state, setKey("t2", 0, { value: -5 as never })), 1)[0].value).toBe(0);
    expect(run(state, setKey("t1", 0.9, { time: 0.2 }))).toBe(state); // no key at 0.9
    expect(run(state, setKey("t1", 0, {}))).toBe(state);
  });

  it("deletes a key and a track", () => {
    const { s, ...w } = base();
    const state = run(s, addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0), addKey(w, "a1", "t1", 0.5));
    const deletedKey = run(state, { type: "ANIM_DELETE_KEY", playerId: w.player, animationId: "a1", trackId: "t1", time: 0 });
    expect(animationsOf(deletedKey, w.player).animations[0].tracks[0].keys.map((k) => k.time)).toEqual([0.5]);
    expect(run(state, { type: "ANIM_DELETE_KEY", playerId: w.player, animationId: "a1", trackId: "t1", time: 0.9 })).toBe(state);
    const deletedTrack = run(state, { type: "ANIM_DELETE_TRACK", playerId: w.player, animationId: "a1", trackId: "t1" });
    expect(animationsOf(deletedTrack, w.player).animations[0].tracks).toEqual([]);
    expect(deletedTrack.animationUi.trackId).toBeNull();
  });
});

describe("deleting what an animation animates", () => {
  it("removes the tracks that target the node (and what is under it) in the same step, and one undo brings both back", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0), addTrack(w, "a1", "t2", "volume", w.sound));
    const deleted = run(s, { type: "DELETE_NODE", id: w.cube });
    expect(animationsOf(deleted, w.player).animations[0].tracks.map((t) => t.id)).toEqual(["t2"]);
    const undone = run(deleted, { type: "UNDO" });
    expect(animationsOf(undone, w.player).animations[0].tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(findSceneNode(undone.sceneRoot, w.cube)).toBeDefined();
    expect(animationsOf(undone, w.player).animations[0].tracks[0].keys).toHaveLength(1);
  });

  it("leaves animations that don't target it as they were (same objects)", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), addTrack(w, "a1", "t2", "volume", w.sound));
    const before = animationsOf(s, w.player).animations[0];
    const deleted = run(s, { type: "DELETE_NODE", id: w.cube });
    expect(animationsOf(deleted, w.player).animations[0]).toBe(before);
  });

  it("deleting the player itself is fine", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), { type: "DELETE_NODE", id: w.player });
    expect(findSceneNode(s.sceneRoot, w.player)).toBeUndefined();
  });
});

describe("the Animation panel's own state", () => {
  it("selecting an AnimationPlayer shows the Animation tab on it; selecting other nodes leaves the tab alone", () => {
    const w = world();
    expect(w.state.activeBottomTab).toBe("Animation");
    expect(w.state.animationUi.playerId).toBe(w.player);
    expect(run(w.state, { type: "SELECT_NODE", id: w.cube }).activeBottomTab).toBe("Animation");
    expect(run(w.state, { type: "SET_BOTTOM_TAB", tab: "Hardware" }, { type: "SELECT_NODE", id: w.sound }).activeBottomTab).toBe("Hardware");
  });

  it("selecting another node ends the preview but leaves the panel where it is, so a node's values can be changed between keys", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), { type: "ANIM_UI", change: { previewTime: 0.5, previewPlaying: true, trackId: "t" } });
    expect(s.animationUi.previewTime).toBe(0.5);
    const moved = run(s, { type: "SELECT_NODE", id: w.cube });
    expect(moved.animationUi).toEqual({ playerId: w.player, animationId: "a1", trackId: "t", keyTime: null, previewTime: null, previewPlaying: false });
    expect(moved.activeBottomTab).toBe("Animation");
  });

  it("selecting a different AnimationPlayer starts the panel afresh on it", () => {
    const w = world();
    const second = run(w.state, { type: "SELECT_NODE", id: w.state.sceneRoot.id }, { type: "ADD_NODE", kind: "AnimationPlayer" });
    const s = run(second, create(second.selectedNodeId, "b1"), { type: "SELECT_NODE", id: w.player });
    expect(s.animationUi).toEqual({ playerId: w.player, animationId: null, trackId: null, keyTime: null, previewTime: null, previewPlaying: false });
  });

  it("the preview and the selection are not edits: no undo step, no unsaved change, nothing saved changes", () => {
    const w = world();
    const s = run(w.state, create(w.player, "a1"), addTrack(w, "a1", "t1"), addKey(w, "a1", "t1", 0));
    const steps = s.history.past.length;
    const saved = { ...s, project: { ...s.project!, scene: s.sceneRoot }, savedScripts: s.project!.scripts };
    const previewing = run(saved, { type: "ANIM_UI", change: { previewTime: 0.5 } }, { type: "ANIM_UI", change: { keyTime: 0, previewPlaying: true } });
    expect(previewing.history.past).toHaveLength(steps);
    expect(hasUnsavedChanges(previewing)).toBe(false);
    expect(previewing.sceneRoot).toBe(s.sceneRoot);
  });

  it("closing a project and opening another starts the panel afresh", () => {
    const w = world();
    const s = run(w.state, { type: "ANIM_UI", change: { previewTime: 1 } });
    const project = createProjectSnapshot({ name: "Q", mode: "3D", scene: createBlankSceneTree("3D") });
    expect(editorReducer(s, { type: "PROJECT_OPENED", filePath: "q.gsds", project }).animationUi.previewTime).toBeNull();
  });
});
