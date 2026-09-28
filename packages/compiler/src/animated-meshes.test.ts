import { createSceneNode, mergeMeshFrames, type ImportedMesh, type ProjectSnapshot, type SceneNode, type SpriteAnimation } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.animated-3d-models.md (the parts that need no toolchain) */

function quad(name: string, x0: number): ImportedMesh {
  return { id: name, name, positions: [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3] };
}
const merged = mergeMeshFrames([quad("hero", -2), quad("hero2", 0), quad("hero3", 1)]);
if (!merged.ok) throw new Error("should merge");
const model: ImportedMesh = { ...merged.mesh, id: "hero" };

const walk: SpriteAnimation = { name: "walk", frames: [0, 1, 2, 1], fps: 12, loop: true };
const jump: SpriteAnimation = { name: "jump", frames: [2], fps: 8, loop: false };

function project(animations: SpriteAnimation[] | undefined, start?: string, extra: Partial<SceneNode> = {}): ProjectSnapshot {
  const base = primitivesProject();
  const hero: SceneNode = {
    ...createSceneNode({ name: "Hero", kind: "MeshInstance3D", transform3D: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }),
    mesh: { importedMeshId: "hero", triangleCount: 2 },
    ...(animations ? { spriteAnimations: { animations, ...(start ? { start } : {}) } } : {}),
    ...extra
  };
  return { ...base, meshes: [model], scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), hero] } };
}

describe("compiling a model with several poses", () => {
  it("builds one vertex table for each pose and lists them for the mesh, with its animations and the one that starts", () => {
    const { scene, diagnostics } = translateScene3D(project([walk, jump], "walk"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.primitives).toHaveLength(3);
    expect(scene!.primitives.map((p) => p.positions[0])).toEqual([-2 * 4096, 0, 4096]);
    expect(scene!.meshFrames).toEqual([0, 1, 2]);
    expect(scene!.meshAnimations).toEqual([
      { frames: [0, 1, 2, 1], step: Math.round((12 * 4096) / 60), loop: true },
      { frames: [2], step: Math.round((8 * 4096) / 60), loop: false }
    ]);
    expect(scene!.meshes[0]).toMatchObject({ primitive: 0, frameStart: 0, frameCount: 3, animation: 0, animationFirst: 0, animationCount: 2 });
  });

  it("has no start animation when none is chosen (the first pose shows)", () => {
    const { scene } = translateScene3D(project([walk, jump]));
    expect(scene!.meshes[0]).toMatchObject({ animation: -1, animationCount: 2, frameCount: 3 });
  });

  it("builds a model with poses but no animations as its first pose only", () => {
    const { scene } = translateScene3D(project(undefined));
    expect(scene!.primitives).toHaveLength(1);
    expect(scene!.meshes[0]).toMatchObject({ frameCount: 0, animation: -1, animationCount: 0 });
    expect(scene!.meshFrames).toEqual([]);
  });

  it("shares the poses' tables between two meshes of the model (each with its own animations)", () => {
    const base = project([walk], "walk");
    const second: SceneNode = { ...base.scene.children.find((n) => n.name === "Hero")!, id: "second", name: "Hero2", spriteAnimations: { animations: [jump], start: "jump" } };
    const { scene } = translateScene3D({ ...base, scene: { ...base.scene, children: [...base.scene.children, second] } });
    expect(scene!.primitives).toHaveLength(3);
    expect(scene!.meshFrames).toEqual([0, 1, 2, 0, 1, 2]);
    expect(scene!.meshes.map((m) => [m.frameStart, m.animationFirst, m.animation])).toEqual([[0, 0, 0], [3, 1, 1]]);
  });

  it("is an error when an animation shows a pose the model doesn't have, and a warning for animations on a one-pose model", () => {
    const bad = translateScene3D(project([{ name: "bad", frames: [0, 3], fps: 8, loop: true }]));
    expect(bad.diagnostics.find((d) => d.code === "animation-frame-out-of-range")).toMatchObject({ severity: "error", nodeName: "Hero" });
    const one = project([walk]);
    const flat = { ...one, meshes: [{ ...model, frames: undefined }] };
    const { scene, diagnostics } = translateScene3D(flat);
    expect(diagnostics.find((d) => d.code === "animated-mesh-without-frames")).toMatchObject({ severity: "warning", nodeName: "Hero" });
    expect(scene!.meshes[0].frameCount).toBe(0);
  });

  it("writes the tables and each mesh's animation fields as C", () => {
    const { scene } = translateScene3D(project([walk, jump], "walk"));
    const c = writeSceneDataC(scene!);
    expect(c).toContain("static const uint16_t mesh_frames[] = { 0, 1, 2 };");
    expect(c).toContain("static const uint16_t mesh_animation_0_frames[] = { 0, 1, 2, 1 };");
    expect(c).toContain(`{ mesh_animation_0_frames, 4, 1, ${Math.round((12 * 4096) / 60)} }`);
    expect(c).toMatch(/static const GsMesh meshes\[\] = \{\n  \{ 0, \d+, 0, \d+, 0, 3, 0, 0, 2, 0, 0 \}\n\};/);
    expect(c).toContain("2, mesh_frames, mesh_animations");
  });

  it("compiles play, stop and is_playing on the mesh to calls with its node and the animation's place", () => {
    const base = project([walk, jump], "walk");
    const driver: SceneNode = { ...createSceneNode({ name: "Driver", kind: "Node3D" }), scriptId: "d" };
    const source = 'func _process(delta):\n    $Hero.play("jump")\n    if $Hero.is_playing():\n        $Hero.stop()\n';
    const { scene, diagnostics } = translateScene3D({ ...base, scene: { ...base.scene, children: [...base.scene.children, driver] }, scripts: [{ id: "d", name: "D", source }] });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const hero = scene!.nodes.findIndex((n) => n.name === "Hero");
    expect(scene!.scriptCode).toContain(`gs_mesh_play(${hero}, 1);`);
    expect(scene!.scriptCode).toContain(`if (gs_mesh_is_playing(${hero})) {`);
    expect(scene!.scriptCode).toContain(`gs_mesh_stop(${hero});`);
  });

  it("refuses play() on a mesh with no animations, naming what it is", () => {
    const base = project(undefined);
    const driver: SceneNode = { ...createSceneNode({ name: "Driver", kind: "Node3D" }), scriptId: "d" };
    const { diagnostics } = translateScene3D({ ...base, scene: { ...base.scene, children: [...base.scene.children, driver] }, scripts: [{ id: "d", name: "D", source: 'func _process(delta):\n    $Hero.play("walk")\n' }] });
    expect(diagnostics.some((d) => d.severity === "error" && /Hero/.test(d.message))).toBe(true);
  });
});
