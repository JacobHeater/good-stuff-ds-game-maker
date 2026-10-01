import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getAudioPlayer, MAX_EXTRA_AUDIO_CLIPS } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/** requirements/audio/STORY.named-audio-clips.md: an AudioStreamPlayer's own named clips, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withPlayer(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "AudioStreamPlayer" });
  return { state, id: state.selectedNodeId! };
}
const clipsOf = (s: EditorState, id: string) => getAudioPlayer(findSceneNode(s.sceneRoot, id)!).clips ?? [];

describe("an AudioStreamPlayer's named clips", () => {
  it("starts with none, adds one named uniquely, and undoes", () => {
    const { state, id } = withPlayer();
    expect(clipsOf(state, id)).toEqual([]);
    const added = run(state, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c1" });
    expect(clipsOf(added, id)).toEqual([{ id: "c1", name: "Sound", volume: 1, pitch: 1, loop: false }]);
    const second = run(added, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c2" });
    expect(clipsOf(second, id).map((c) => c.name)).toEqual(["Sound", "Sound2"]);
    expect(clipsOf(run(second, { type: "UNDO" }), id).map((c) => c.name)).toEqual(["Sound"]);
  });

  it("refuses a name already used by another clip, or an empty one, but allows keeping its own", () => {
    const { state, id } = withPlayer();
    const withTwo = run(state, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c1" }, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c2" });
    const renamed = run(withTwo, { type: "AUDIO_CLIP_RENAME", playerId: id, clipId: "c2", name: "Morning", at: 1 });
    expect(clipsOf(renamed, id).map((c) => c.name)).toEqual(["Sound", "Morning"]);
    expect(run(renamed, { type: "AUDIO_CLIP_RENAME", playerId: id, clipId: "c1", name: "Morning", at: 2 })).toBe(renamed);
    expect(run(renamed, { type: "AUDIO_CLIP_RENAME", playerId: id, clipId: "c1", name: "  ", at: 2 })).toBe(renamed);
    expect(run(renamed, { type: "AUDIO_CLIP_RENAME", playerId: id, clipId: "c1", name: "Sound", at: 2 })).toBe(renamed);
  });

  it("sets a clip's sound, volume, pitch and loop one at a time, clamping and ignoring a no-op", () => {
    const { state, id } = withPlayer();
    const withClip = run(state, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c1" });
    const withSound = run(withClip, { type: "AUDIO_CLIP_SET", playerId: id, clipId: "c1", change: { soundId: "snd-1" }, at: 1 });
    expect(clipsOf(withSound, id)[0].soundId).toBe("snd-1");
    const loud = run(withSound, { type: "AUDIO_CLIP_SET", playerId: id, clipId: "c1", change: { volume: 5 }, at: 2 });
    expect(clipsOf(loud, id)[0].volume).toBe(1); // clamped to 1
    const looped = run(loud, { type: "AUDIO_CLIP_SET", playerId: id, clipId: "c1", change: { loop: true }, at: 3 });
    expect(clipsOf(looped, id)[0].loop).toBe(true);
    expect(run(looped, { type: "AUDIO_CLIP_SET", playerId: id, clipId: "c1", change: { loop: true }, at: 4 })).toBe(looped);
    const cleared = run(looped, { type: "AUDIO_CLIP_SET", playerId: id, clipId: "c1", change: { soundId: null }, at: 5 });
    expect(clipsOf(cleared, id)[0].soundId).toBeUndefined();
  });

  it("deletes a clip, clearing the whole clips field once none are left", () => {
    const { state, id } = withPlayer();
    const withTwo = run(state, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c1" }, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "c2" });
    const withOne = run(withTwo, { type: "AUDIO_CLIP_DELETE", playerId: id, clipId: "c1" });
    expect(clipsOf(withOne, id).map((c) => c.id)).toEqual(["c2"]);
    const withNone = run(withOne, { type: "AUDIO_CLIP_DELETE", playerId: id, clipId: "c2" });
    expect(findSceneNode(withNone.sceneRoot, id)!.audio?.clips).toBeUndefined();
  });

  it("stops at MAX_EXTRA_AUDIO_CLIPS", () => {
    const { state, id } = withPlayer();
    const full = run(state, ...Array.from({ length: MAX_EXTRA_AUDIO_CLIPS }, (_, i): Action => ({ type: "AUDIO_CLIP_CREATE", playerId: id, id: `c${i}` })));
    expect(clipsOf(full, id)).toHaveLength(MAX_EXTRA_AUDIO_CLIPS);
    expect(run(full, { type: "AUDIO_CLIP_CREATE", playerId: id, id: "one-too-many" })).toBe(full);
  });

  it("ignores a node that isn't an AudioStreamPlayer", () => {
    const state = run(withPlayer().state, { type: "ADD_NODE", kind: "Node3D" });
    const other = state.selectedNodeId!;
    expect(run(state, { type: "AUDIO_CLIP_CREATE", playerId: other, id: "c1" })).toBe(state);
  });
});
