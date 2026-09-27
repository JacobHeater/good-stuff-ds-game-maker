import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { scriptedProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/collision/STORY.collision-polygon-wraps-mesh.md: a CollisionShape3D whose shape is "convexHull" wraps its parent MeshInstance3D. */

const CHECK = "func _process(delta):\n    if $Wrap.overlaps($Wrap):\n        pass\n";
const F = (v: number): number => v / 4096;

function wrapShape(transform3D?: SceneNode["transform3D"]): SceneNode {
  const node = createSceneNode({ name: "Wrap", kind: "CollisionShape3D", transform3D });
  node.collision = { shape: "convexHull" };
  return node;
}

function meshWithHull(name: string, meshTransform?: SceneNode["transform3D"], shapeTransform?: SceneNode["transform3D"]): SceneNode {
  return createSceneNode({ name, kind: "MeshInstance3D", mesh: "cube", transform3D: meshTransform, children: [wrapShape(shapeTransform)] });
}

describe("a convex hull collision shape wraps its parent mesh", () => {
  it("takes its points from a cube's own corners when it sits right on the mesh (no offset)", () => {
    const scene = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [meshWithHull("Player")])).scene!;
    const collider = scene.colliders[0];
    expect(collider.shape).toBe("convexHull");
    expect(collider.hull).toBeDefined();
    expect(collider.hull!.length).toBeGreaterThan(0);
    expect(collider.hull!.length).toBeLessThanOrEqual(26);
    // A unit cube (the "cube" primitive spans -0.5..0.5): every hull point should be one of its 8 corners.
    for (const [x, y, z] of collider.hull!) {
      expect(Math.abs(F(x))).toBeCloseTo(0.5, 4);
      expect(Math.abs(F(y))).toBeCloseTo(0.5, 4);
      expect(Math.abs(F(z))).toBeCloseTo(0.5, 4);
    }
    // The bounding radius (params[0]) is the corner's own distance from the origin: sqrt(0.5^2 * 3).
    expect(F(collider.params[0])).toBeCloseTo(Math.sqrt(0.75), 3);
  });

  it("is unaffected by the mesh's own position and scale: like a box's half extents, the hull is pre-scale, in local space", () => {
    // The shape sits right on Player with no offset of its own, so its own local space IS Player's local space: Player's world position and
    // scale (applied by the runtime's own scale[]/center[], exactly as they are for a box or a sphere) shouldn't be baked into the points here.
    const player = meshWithHull("Player", { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 } });
    const scene = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [player])).scene!;
    const collider = scene.colliders[0];
    const maxAbsX = Math.max(...collider.hull!.map(([x]) => Math.abs(F(x))));
    expect(maxAbsX).toBeCloseTo(0.5, 3);
  });

  it("follows the shape node's own offset relative to the mesh (the hull is in the shape's own local space)", () => {
    // The shape sits 1 unit further along X than its parent mesh: every hull point should be shifted -1 on X in the shape's own frame.
    const player = meshWithHull("Player", undefined, { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    const scene = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [player])).scene!;
    const collider = scene.colliders[0];
    const xs = collider.hull!.map(([x]) => F(x));
    expect(Math.max(...xs)).toBeCloseTo(-0.5, 3);
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 3);
  });

  it("is an error when the parent isn't a MeshInstance3D", () => {
    const holder = createSceneNode({ name: "Holder", kind: "Node3D", children: [wrapShape()] });
    const r = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [holder]));
    expect(r.scene).toBeNull();
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "collision-hull-needs-mesh", nodeName: "Wrap" }));
  });

  it("is an error when the parent mesh has no geometry", () => {
    const empty = createSceneNode({ name: "Player", kind: "MeshInstance3D", children: [wrapShape()] });
    empty.mesh = undefined;
    const r = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [empty]));
    expect(r.scene).toBeNull();
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "collision-hull-needs-mesh", nodeName: "Wrap" }));
  });

  it("is an error when it's a direct child of the scene root (a Node3D, not a mesh)", () => {
    const r = translateScene3D(scriptedProject([{ source: CHECK, attachTo: ["Wrap"] }], [wrapShape()]));
    expect(r.scene).toBeNull();
    expect(r.diagnostics.some((d) => d.code === "collision-hull-needs-mesh")).toBe(true);
  });
});
