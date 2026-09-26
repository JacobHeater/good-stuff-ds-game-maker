import { createBlankSceneTree, createProjectSnapshot, createSpriteFromRgba, findSceneNode, getSpriteAnimations, type ImportedSprite } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.animated-sprites.md: importing a sheet and editing an AnimatedSprite2D's animations in the editor's state. */

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
/** A sheet of `count` 16 x 16 frames in a row. */
function sheet(id: string, count: number, name = id): ImportedSprite {
  const made = createSpriteFromRgba(new Uint8Array(count * 16 * 16 * 4).fill(200), count * 16, 16, { name, frame: { width: 16, height: 16 } });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}
const picture = (id: string): ImportedSprite => {
  const made = createSpriteFromRgba(new Uint8Array(16 * 16 * 4).fill(200), 16, 16, { name: id });
  if (!made.ok) throw new Error("didn't convert");
  return { id, ...made.sprite };
};

/** A project with an AnimatedSprite2D (selected) that has the 4-frame sheet "s" on it. */
function withAnimatedSprite(): { state: EditorState; id: string } {
  const added = run(openProject(), { type: "ADD_NODE", kind: "AnimatedSprite2D" });
  const id = added.selectedNodeId;
  const state = run(added, { type: "IMPORT_SPRITE", nodeId: id, sprite: sheet("s", 4, "run"), warnings: [] });
  return { state, id };
}
const animationsOf = (s: EditorState, id: string) => getSpriteAnimations(findSceneNode(s.sceneRoot, id)!);
const undo: Action = { type: "UNDO" };

describe("importing a sprite sheet", () => {
  it("onto an AnimatedSprite2D puts the sheet on it with one animation that plays every frame from the start", () => {
    const { state, id } = withAnimatedSprite();
    expect(findSceneNode(state.sceneRoot, id)!.spriteId).toBe("s");
    expect(animationsOf(state, id)).toEqual({ animations: [{ name: "default", frames: [0, 1, 2, 3], fps: 8, loop: true }], start: "default" });
    expect(state.outputLog.slice(-1)[0]).toMatch(/Imported sprite sheet "run" \(64 x 16, 1024 bytes of sprite memory\) onto/);
  });

  it("with nothing selected arrives as a new AnimatedSprite2D playing all its frames; a single picture still arrives as a Sprite2D", () => {
    const imported = run(openProject(), { type: "IMPORT_SPRITE", nodeId: null, sprite: sheet("s", 3, "walk"), warnings: [] });
    const node = findSceneNode(imported.sceneRoot, imported.selectedNodeId)!;
    expect(node).toMatchObject({ kind: "AnimatedSprite2D", name: "walk", spriteId: "s", position: { x: 128, y: 96 } });
    expect(getSpriteAnimations(node).start).toBe("default");
    const single = run(openProject(), { type: "IMPORT_SPRITE", nodeId: null, sprite: picture("p"), warnings: [] });
    expect(findSceneNode(single.sceneRoot, single.selectedNodeId)!.kind).toBe("Sprite2D");
  });

  it("choosing a smaller sheet drops the frames it doesn't have, and an animation left empty goes with its start", () => {
    const { state, id } = withAnimatedSprite();
    const edited = run(
      state,
      { type: "SPRITE_ANIM_ADD", id },
      { type: "SPRITE_ANIM_SET", id, index: 1, change: { name: "last", frames: [3] }, at: 1 },
      { type: "SPRITE_ANIM_START", id, name: "last" }
    );
    const smaller = run(edited, { type: "IMPORT_SPRITE", nodeId: id, sprite: sheet("t", 2), warnings: [] });
    expect(animationsOf(smaller, id)).toEqual({ animations: [{ name: "default", frames: [0, 1], fps: 8, loop: true }] });
  });

  it("can be undone", () => {
    const { state, id } = withAnimatedSprite();
    const undone = run(state, undo);
    expect(undone.project!.sprites).toBeUndefined();
    expect(findSceneNode(undone.sceneRoot, id)!.spriteAnimations).toBeUndefined();
  });
});

describe("editing animations", () => {
  it("adds animations with names that don't clash, the first one starting", () => {
    const added = run(openProject(), { type: "ADD_NODE", kind: "AnimatedSprite2D" });
    const id = added.selectedNodeId;
    const two = run(added, { type: "SPRITE_ANIM_ADD", id }, { type: "SPRITE_ANIM_ADD", id });
    expect(animationsOf(two, id).animations.map((a) => [a.name, a.frames])).toEqual([["anim", [0]], ["anim2", [0]]]);
    expect(animationsOf(two, id).start).toBe("anim");
  });

  it("changes a name (keeping the start), frames, speed and looping, and refuses what a script or the sheet couldn't have", () => {
    const { state, id } = withAnimatedSprite();
    const s = run(state, { type: "SPRITE_ANIM_SET", id, index: 0, change: { name: "run", frames: [3, 2, 1, 0], fps: 12, loop: false }, at: 1 });
    expect(animationsOf(s, id)).toEqual({ animations: [{ name: "run", frames: [3, 2, 1, 0], fps: 12, loop: false }], start: "run" });
    // a frame the 4-frame sheet doesn't have, an empty list, an empty name, a speed off the scale
    expect(run(s, { type: "SPRITE_ANIM_SET", id, index: 0, change: { frames: [4] }, at: 2 })).toBe(s);
    expect(run(s, { type: "SPRITE_ANIM_SET", id, index: 0, change: { frames: [] }, at: 2 })).toBe(s);
    expect(run(s, { type: "SPRITE_ANIM_SET", id, index: 0, change: { name: "  " }, at: 2 })).toBe(s);
    expect(animationsOf(run(s, { type: "SPRITE_ANIM_SET", id, index: 0, change: { fps: 900 }, at: 2 }), id).animations[0].fps).toBe(60);
    // the same value again is not an edit
    expect(run(s, { type: "SPRITE_ANIM_SET", id, index: 0, change: { fps: 12 }, at: 2 })).toBe(s);
  });

  it("refuses a name another animation has", () => {
    const { state, id } = withAnimatedSprite();
    const two = run(state, { type: "SPRITE_ANIM_ADD", id });
    expect(run(two, { type: "SPRITE_ANIM_SET", id, index: 1, change: { name: "default" }, at: 1 })).toBe(two);
  });

  it("removes an animation, forgetting the start if it was that one; chooses or clears the start", () => {
    const { state, id } = withAnimatedSprite();
    const two = run(state, { type: "SPRITE_ANIM_ADD", id });
    const removed = run(two, { type: "SPRITE_ANIM_REMOVE", id, index: 0 });
    expect(animationsOf(removed, id)).toEqual({ animations: [{ name: "anim", frames: [0], fps: 8, loop: true }] });
    const started = run(removed, { type: "SPRITE_ANIM_START", id, name: "anim" });
    expect(animationsOf(started, id).start).toBe("anim");
    expect(animationsOf(run(started, { type: "SPRITE_ANIM_START", id, name: null }), id).start).toBeUndefined();
    expect(run(started, { type: "SPRITE_ANIM_START", id, name: "nope" })).toBe(started);
  });

  it("does nothing to a node that isn't an AnimatedSprite2D", () => {
    const sprite = run(openProject(), { type: "ADD_NODE", kind: "Sprite2D" });
    expect(run(sprite, { type: "SPRITE_ANIM_ADD", id: sprite.selectedNodeId })).toBe(sprite);
  });

  it("keeps typing in one field to one undo step, and undoes an edit", () => {
    const { state, id } = withAnimatedSprite();
    const typed = run(
      state,
      { type: "SPRITE_ANIM_SET", id, index: 0, change: { fps: 1 }, at: 1000 },
      { type: "SPRITE_ANIM_SET", id, index: 0, change: { fps: 12 }, at: 1100 },
      { type: "SPRITE_ANIM_SET", id, index: 0, change: { fps: 15 }, at: 1200 }
    );
    expect(animationsOf(typed, id).animations[0].fps).toBe(15);
    expect(animationsOf(run(typed, undo), id).animations[0].fps).toBe(8);
  });

  it("scales and turns like a Sprite2D", () => {
    const { state, id } = withAnimatedSprite();
    const turned = run(state, { type: "SET_SPRITE_TRANSFORM", id, change: { rotation: 45 }, at: 1 });
    expect(findSceneNode(turned.sceneRoot, id)!.transform2D?.rotation).toBe(45);
  });
});
