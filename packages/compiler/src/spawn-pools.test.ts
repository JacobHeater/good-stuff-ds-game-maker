import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, DEFAULT_START_SCENE_ID, withSceneEntries, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject, fullBudgetProject } from "./fixtures";
import { translateProject3D } from "./translate-project";
import { translateScene2D } from "./translate-scene-2d";

/** requirements/scene-designer/STORY.spawn-pools.md: N pre-built, initially hidden copies of a template scene, each spawn()/despawn()-able at runtime. */

// ---- 2D -----------------------------------------------------------------------------------------------------------------------------------------------------------------------

const image = (id: string): ImportedSprite => {
  const made = createSpriteFromRgba(new Uint8Array(16 * 16 * 4).fill(255), 16, 16, { name: id });
  if (!made.ok) throw new Error("didn't convert");
  return { id, ...made.sprite };
};
const sprite2D = (name: string, x: number, y: number): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", screen: "top", position: { x, y } }), spriteId: "i" });
const pool2D = (name: string, of: string, count: number, x = 0, y = 0): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", screen: "top", position: { x, y } }), instanceOf: of, spawnPoolCount: count });

/** A start scene "Level" (the nodes given) and a "Campfire" scene (two sprites, Body -- the scene's own root -- then its own child Glow, so a copy's own subtree is more than one node). */
function project2D(levelChildren: SceneNode[], extraScenes: ReadonlyArray<{ id: string; name: string; scene: SceneNode }> = []): ProjectSnapshot {
  const campfire: SceneNode = { ...sprite2D("Body", 0, 0), children: [sprite2D("Glow", 0, 0)] };
  const level = createSceneNode({ name: "Level", kind: "Node2D", children: levelChildren });
  const base: ProjectSnapshot = { ...createProjectSnapshot({ name: "P", mode: "2D", scene: level }), sprites: [image("i")] };
  return withSceneEntries(base, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
    { id: "campfire", name: "Campfire", scene: campfire, isStart: false },
    ...extraScenes.map((e) => ({ ...e, isStart: false }))
  ]);
}

describe("spawn pools in a 2D project (STORY.spawn-pools.md)", () => {
  it("compiles a pool's N copies as a contiguous run in the node table: slot i's own root is nodeStart + i * nodesPerCopy", () => {
    const { scene, diagnostics } = translateScene2D(project2D([pool2D("Campfires", "campfire", 3)]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.spawnPools).toEqual([{ nodeStart: expect.any(Number), nodesPerCopy: 2, count: 3, screen: "top" }]);
    const pool = scene!.spawnPools[0];
    for (let i = 0; i < pool.count; i++) {
      expect(scene!.nodes[pool.nodeStart + i * pool.nodesPerCopy].name).toBe("Campfires"); // each copy's own root takes the pool node's own name (expandSceneInstances)
      expect(scene!.nodes[pool.nodeStart + i * pool.nodesPerCopy + 1].name).toBe("Glow"); // a descendant keeps its own template-authored name
    }
  });

  it("forces every node of every copy dynamic and visible -- 2D has no parent-to-child cascade, unlike 3D", () => {
    const { scene } = translateScene2D(project2D([pool2D("Campfires", "campfire", 2)]));
    const pool = scene!.spawnPools[0];
    expect(scene!.top.sprites.filter((s) => s.node !== undefined && s.node >= pool.nodeStart && s.node < pool.nodeStart + pool.count * pool.nodesPerCopy).every((s) => s.dynamic)).toBe(true);
    expect(scene!.top.sprites).toHaveLength(4); // 2 copies x 2 sprites each
  });

  it("a pool's own sprites share the exact same per-screen sprite budget as ordinary ones, and too-many-sprites fires once it overflows", () => {
    const filler = Array.from({ length: 127 }, (_, i) => sprite2D(`S${i}`, 0, 0));
    const underBudget = translateScene2D(project2D(filler));
    expect(underBudget.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const overBudget = translateScene2D(project2D([...filler, pool2D("Campfires", "campfire", 2)])); // +4 sprites (2 copies x 2) = 131
    expect(overBudget.diagnostics.map((d) => d.code)).toContain("too-many-sprites");
  });

  it("a pool naming a missing scene still compiles (N empty, spawnable-but-drawing-nothing copies), with the same scene-instance-missing warning an ordinary instance gets", () => {
    const { scene, diagnostics } = translateScene2D(project2D([pool2D("Ghosts", "nope", 2)]));
    expect(scene!.spawnPools).toHaveLength(1); // same soft-fail philosophy as a dangling instance: it still compiles, just empty
    expect(diagnostics.find((d) => d.code === "scene-instance-missing")).toMatchObject({ severity: "warning", nodeName: "Ghosts" });
  });

  it("refuses a pool whose own template already contains a pool, with a nested-spawn-pool error", () => {
    const inner = createSceneNode({ name: "InnerRoot", kind: "Node2D", children: [pool2D("InnerPool", "campfire", 2)] });
    const { scene, diagnostics } = translateScene2D(project2D([pool2D("OuterPool", "holder", 2)], [{ id: "holder", name: "Holder", scene: inner }]));
    expect(scene).toBeNull();
    expect(diagnostics.find((d) => d.code === "nested-spawn-pool")).toMatchObject({ severity: "error", nodeName: "OuterPool" });
  });

  it("an ordinary instance (no pool count) is completely unaffected by expandSpawnPools: its own visible content compiles normally, and no spawn pool is compiled for it", () => {
    const instance: SceneNode = { ...createSceneNode({ name: "One", kind: "Node2D", screen: "top" }), instanceOf: "campfire" };
    const { scene, diagnostics } = translateScene2D(project2D([instance]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.spawnPools).toEqual([]);
    expect(scene!.top.sprites).toHaveLength(2); // Body and Glow, drawn as ordinary, visible (not forced-hidden), non-pool content
    expect(scene!.top.sprites.every((s) => s.dynamic === false)).toBe(true); // nothing scripts or spawns it, so it's never touched -- static, same as any other unreached instance
  });
});

// ---- 3D -----------------------------------------------------------------------------------------------------------------------------------------------------------------------

const cubeTemplate = (): SceneNode => createSceneNode({ name: "CubeRoot", kind: "MeshInstance3D", mesh: "cube" });
const pool3D = (name: string, of: string, count: number): SceneNode => ({ ...createSceneNode({ name, kind: "Node3D" }), instanceOf: of, spawnPoolCount: count });

/** A light base (cubeProject's own single cube, camera and light -- plenty of triangle budget to spare) so these tests aren't sensitive to the DS's own triangle ceiling; the budget test below uses a heavier base of its own. */
function project3D(levelExtra: SceneNode[], extraScenes: ReadonlyArray<{ id: string; name: string; scene: SceneNode }> = [], base: ProjectSnapshot = cubeProject()): ProjectSnapshot {
  const level: SceneNode = { ...base.scene, children: [...base.scene.children, ...levelExtra] };
  return withSceneEntries({ ...base, scene: level }, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
    { id: "cube-template", name: "CubeTemplate", scene: cubeTemplate(), isStart: false },
    ...extraScenes.map((e) => ({ ...e, isStart: false }))
  ]);
}

describe("spawn pools in a 3D project (STORY.spawn-pools.md)", () => {
  it("compiles a pool's N copies as a contiguous run in the node table", () => {
    const { scenes, diagnostics } = translateProject3D(project3D([pool3D("Enemies", "cube-template", 2)]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const level = scenes![0];
    const pool = level.spawnPools[0];
    expect(pool).toMatchObject({ nodesPerCopy: 1, count: 2 });
    expect(level.nodes[pool.nodeStart].name).toBe("Enemies");
    expect(level.nodes[pool.nodeStart + pool.nodesPerCopy].name).toBe("Enemies");
  });

  it("forces only each copy's own root dynamic -- 3D's own world-transform cascade (parentDynamic) handles the rest", () => {
    const deepTemplate = createSceneNode({ name: "RigRoot", kind: "Node3D", children: [createSceneNode({ name: "Child", kind: "MeshInstance3D", mesh: "sphere" })] });
    const { scenes, diagnostics } = translateProject3D(project3D([pool3D("Rigs", "rig", 2)], [{ id: "rig", name: "Rig", scene: deepTemplate }]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const level = scenes![0];
    const child = level.nodes.find((n) => n.name === "Child");
    expect(child?.dynamic).toBe(true); // cascaded from its own copy's dynamic root, never touched individually
  });

  it("a pool's own meshes share the exact same per-scene triangle budget as ordinary ones, and over-triangle-budget fires once it overflows", () => {
    // fullBudgetProject: 169 cubes, 2028 of the DS's own 2048-triangle budget -- room for a small pool to tip it over.
    const underBudget = translateProject3D(project3D([], [], fullBudgetProject()));
    expect(underBudget.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const overBudget = translateProject3D(project3D([pool3D("Enemies", "cube-template", 2)], [], fullBudgetProject())); // +2 cubes (24 triangles) over 2028/2048
    expect(overBudget.diagnostics.map((d) => d.code)).toContain("over-triangle-budget");
  });

  it("a pool naming a missing scene gets the same scene-instance-missing warning an ordinary instance does", () => {
    const { diagnostics } = translateProject3D(project3D([pool3D("Ghosts", "nope", 2)]));
    expect(diagnostics.find((d) => d.code === "scene-instance-missing")).toMatchObject({ severity: "warning", nodeName: "Ghosts" });
  });

  it("refuses a pool whose own template already contains a pool, with a nested-spawn-pool error", () => {
    const inner = createSceneNode({ name: "InnerRoot", kind: "Node3D", children: [pool3D("InnerPool", "cube-template", 2)] });
    const { scenes, diagnostics } = translateProject3D(project3D([pool3D("OuterPool", "holder", 2)], [{ id: "holder", name: "Holder", scene: inner }]));
    expect(scenes).toBeNull();
    expect(diagnostics.find((d) => d.code === "nested-spawn-pool")).toMatchObject({ severity: "error", nodeName: "OuterPool" });
  });
});

// ---- Script API (spawn/despawn/is_spawned) -------------------------------------------------------------------------------------------------------------------------------------

describe("spawn()/despawn()/is_spawned() script calls compile to the expected C (STORY.spawn-pools.md)", () => {
  it("2D: spawn(name, x, y) resolves the pool's own index and compiles to gs_spawn/gs_despawn/gs_is_spawned", () => {
    const script: SceneNode = { ...createSceneNode({ name: "Script", kind: "Node2D", screen: "top" }), scriptId: "s" };
    const project: ProjectSnapshot = {
      ...project2D([pool2D("Campfires", "campfire", 2), script]),
      scripts: [{ id: "s", name: "S", source: 'func _process(delta):\n    var h = spawn("Campfires", 10.0, 20.0)\n    if is_spawned(h):\n        despawn(h)\n' }]
    };
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.scriptCode).toContain("gs_spawn(0,");
    expect(scene!.scriptCode).toContain("gs_is_spawned(");
    expect(scene!.scriptCode).toContain("gs_despawn(");
  });

  it("3D: spawn(name, x, y, z) resolves the pool's own index and compiles to gs_spawn/gs_despawn/gs_is_spawned", () => {
    const base = cubeProject();
    const script: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "s" };
    const level: SceneNode = { ...base.scene, children: [...base.scene.children.filter((n) => n.name !== "Cube"), script, pool3D("Enemies", "cube-template", 2)] };
    const project: ProjectSnapshot = {
      ...withSceneEntries({ ...base, scene: level }, [
        { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
        { id: "cube-template", name: "CubeTemplate", scene: cubeTemplate(), isStart: false }
      ]),
      scripts: [{ id: "s", name: "S", source: 'func _process(delta):\n    var h = spawn("Enemies", 1.0, 2.0, 3.0)\n    if is_spawned(h):\n        despawn(h)\n' }]
    };
    const { scenes, diagnostics } = translateProject3D(project);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const code = scenes![0].scriptCode;
    expect(code).toContain("gs_spawn(0,");
    expect(code).toContain("gs_is_spawned(");
    expect(code).toContain("gs_despawn(");
  });

  it("is an error to name a spawn pool the project doesn't have, listing the one it does, and failing the whole compile", () => {
    const script: SceneNode = { ...createSceneNode({ name: "Script", kind: "Node2D", screen: "top" }), scriptId: "s" };
    const project: ProjectSnapshot = {
      ...project2D([pool2D("Campfires", "campfire", 2), script]),
      scripts: [{ id: "s", name: "S", source: 'func _process(delta):\n    spawn("Ghost", 0.0, 0.0)\n' }]
    };
    const { scene, diagnostics } = translateScene2D(project);
    expect(scene).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.message.includes("Ghost") && d.message.includes("Campfires"))).toBe(true);
  });
});
