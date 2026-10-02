import { describe, expect, it } from "vitest";

import { computeSceneBudget } from "./budget";
import { getPrimitiveTriangleCount } from "./primitive-geometry";
import { createProjectSnapshot, type ProjectSnapshot } from "./project-snapshot";
import { DEFAULT_START_SCENE_ID, expandSceneInstances, withSceneEntries } from "./project-scenes";
import { createSceneNode, type SceneNode } from "./scene-node";

/**
 * requirements/scene-designer/STORY.scene-instances.md: an instanced scene's own meshes must count toward the
 * triangle budget too, the same way the compiler already counts them when it builds the ROM (it compiles the
 * expanded tree, `translate-project.ts`) -- a live budget read straight off the un-expanded scene tree would show
 * "under budget" for a scene the compiler actually refuses.
 */

function world(levelChildren: SceneNode[]): ProjectSnapshot {
  const prop = createSceneNode({ name: "PropRoot", kind: "Node3D", children: [createSceneNode({ name: "Cube", kind: "MeshInstance3D", mesh: "cube" })] });
  const base = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Level", kind: "Node3D", children: levelChildren }) });
  return withSceneEntries(base, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: base.scene, isStart: true },
    { id: "prop", name: "Prop", scene: prop, isStart: false }
  ]);
}

describe("a scene's triangle budget", () => {
  it("doesn't count an instanced scene's meshes when read off the un-expanded tree", () => {
    const instance = { ...createSceneNode({ name: "Tree", kind: "Node3D" }), instanceOf: "prop" };
    const project = world([instance]);
    expect(computeSceneBudget(project.scene).trianglesUsed).toBe(0);
  });

  it("counts an instanced scene's meshes once expanded, matching what the compiler builds", () => {
    const instance = { ...createSceneNode({ name: "Tree", kind: "Node3D" }), instanceOf: "prop" };
    const project = world([instance]);
    const expanded = expandSceneInstances(project, project.scene);
    expect(computeSceneBudget(expanded).trianglesUsed).toBe(getPrimitiveTriangleCount("cube"));
  });

  it("counts several instances of the same scene separately, and a mesh outside any instance too", () => {
    const direct = createSceneNode({ name: "Direct", kind: "MeshInstance3D", mesh: "cube" });
    const a = { ...createSceneNode({ name: "A", kind: "Node3D" }), instanceOf: "prop" };
    const b = { ...createSceneNode({ name: "B", kind: "Node3D" }), instanceOf: "prop" };
    const project = world([direct, a, b]);
    const expanded = expandSceneInstances(project, project.scene);
    expect(computeSceneBudget(expanded).trianglesUsed).toBe(getPrimitiveTriangleCount("cube") * 3);
  });

  it("doubles the limit at 30fps, since half the frame rate gives the GPU twice as long per frame", () => {
    const empty = createSceneNode({ name: "Main", kind: "Node3D" });
    const at60 = computeSceneBudget(empty, undefined, undefined, undefined, undefined, 60);
    const at30 = computeSceneBudget(empty, undefined, undefined, undefined, undefined, 30);
    expect(at30.trianglesLimit).toBe(at60.trianglesLimit * 2);
  });

  it("defaults to 60fps's limit when no target is given", () => {
    const empty = createSceneNode({ name: "Main", kind: "Node3D" });
    expect(computeSceneBudget(empty).trianglesLimit).toBe(computeSceneBudget(empty, undefined, undefined, undefined, undefined, 60).trianglesLimit);
  });
});
