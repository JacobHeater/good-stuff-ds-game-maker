import { createBlankSceneTree, createProjectSnapshot, findSceneNode, getSpriteAnimations, mergeMeshFrames, type ImportedMesh } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.animated-3d-models.md: editing the animations of a model with several poses. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
const quad = (name: string, x0: number): ImportedMesh => ({ id: name, name, positions: [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] });

function withModel(poses = 3): { state: EditorState; id: string } {
  const merged = mergeMeshFrames(Array.from({ length: poses }, (_, i) => quad(`walk${i + 1}`, i)));
  if (!merged.ok) throw new Error("should merge");
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "IMPORT_MESH", mesh: { ...merged.mesh, id: "walk", name: "walk" }, warnings: [] });
  return { state, id: state.selectedNodeId! };
}
const animsOf = (s: EditorState, id: string) => getSpriteAnimations(findSceneNode(s.sceneRoot, id)!);

describe("animations of a model with several poses", () => {
  it("logs how many poses an imported model has", () => {
    expect(withModel().state.outputLog.some((line) => /3 poses/.test(line))).toBe(true);
  });

  it("can be added, given poses, named, started and removed, like a sprite's", () => {
    const { state, id } = withModel();
    const added = run(state, { type: "SPRITE_ANIM_ADD", id });
    expect(animsOf(added, id).animations).toHaveLength(1);
    expect(animsOf(added, id).start).toBe("anim");
    const set = run(added, { type: "SPRITE_ANIM_SET", id, index: 0, change: { name: "walk", frames: [0, 1, 2, 1], fps: 10 }, at: 1 });
    expect(animsOf(set, id).animations[0]).toMatchObject({ name: "walk", frames: [0, 1, 2, 1], fps: 10 });
    expect(animsOf(set, id).start).toBe("walk");
    expect(animsOf(run(set, { type: "SPRITE_ANIM_START", id, name: null }), id).start).toBeUndefined();
    expect(animsOf(run(set, { type: "SPRITE_ANIM_REMOVE", id, index: 0 }), id).animations).toEqual([]);
  });

  it("only allows poses the model has", () => {
    const { state, id } = withModel(3);
    const added = run(state, { type: "SPRITE_ANIM_ADD", id });
    expect(run(added, { type: "SPRITE_ANIM_SET", id, index: 0, change: { frames: [0, 3] }, at: 1 })).toBe(added);
    expect(run(added, { type: "SPRITE_ANIM_SET", id, index: 0, change: { frames: [0, 2] }, at: 1 })).not.toBe(added);
  });
});
