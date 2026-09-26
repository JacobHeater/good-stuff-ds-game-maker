import { buildArm, importGltf, flattenSceneTree, type ProjectSnapshot, type RiggedModel } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.rigged-models.md (the parts that need no toolchain): an imported rigged model compiles and animates like any nodes. */

function imported(animated: boolean): RiggedModel {
  const r = importGltf({ json: buildArm({ animation: true }).json, buffers: [buildArm({ animation: true }).bin] }, "Robot");
  if (!r.ok) throw new Error(r.errors.join(" "));
  if (animated) {
    const player = flattenSceneTree(r.model.root).find((n) => n.kind === "AnimationPlayer")!;
    player.animation!.autoplay = player.animation!.animations![0].id;
  }
  return r.model;
}

function riggedProject(model: RiggedModel): ProjectSnapshot {
  const base = primitivesProject();
  return { ...base, meshes: model.meshes, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), model.root] } };
}

describe("an imported rigged model in a compiled scene", () => {
  it("compiles without errors: the meshes under their bones, and the clip as an animation on the arm bone", () => {
    const { scene, diagnostics } = translateScene3D(riggedProject(imported(true)));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.meshes).toHaveLength(2);
    expect(scene!.animationPlayers).toHaveLength(1);
    expect(scene!.animations.map((a) => a.name)).toEqual(["bend"]);
    const arm = scene!.nodes.findIndex((n) => n.name === "Arm");
    expect(scene!.animationTracks.every((t) => t.node === arm)).toBe(true);
    expect(scene!.animationTracks[0].property).toBe("rotation");
  });

  it("makes the animated bone and everything under it move, but not the hip", () => {
    const { scene } = translateScene3D(riggedProject(imported(true)));
    const dynamic = (name: string) => scene!.nodes[scene!.nodes.findIndex((n) => n.name === name)].dynamic;
    expect(dynamic("Arm")).toBe(true);
    expect(dynamic("Arm_mesh")).toBe(true);
    expect(dynamic("Hip")).toBe(false);
  });

  it("keeps each part's own color", () => {
    const { scene } = translateScene3D(riggedProject(imported(false)));
    expect(new Set(scene!.meshes.map((m) => m.diffuse)).size).toBe(1);
    expect(scene!.meshes[0].diffuse).toBe(31); // red: 31 in the low five bits, no green, no blue
  });
});
