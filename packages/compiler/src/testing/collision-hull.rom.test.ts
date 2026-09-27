import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * A convex hull collision shape (requirements/collision/STORY.collision-polygon-wraps-mesh.md) on the real DS CPU. The "cube" mesh is a 1 x 1 x 1
 * box centered on its node, so its k-DOP hull is (up to floating point) exactly that box's 8 corners: every case below has an answer that can be
 * hand-checked against ordinary box geometry, which is what proves gs_shapes_overlap's new GS_SHAPE_HULL support function (an O(point count) lookup,
 * not a formula like the other shapes) actually agrees with the DS's real GJK search, not just the compiler's own (already unit-tested) hull math.
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

describe.skipIf(!toolchain.found)("a convex hull collision shape on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-hull-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const player = createSceneNode({
    name: "Player",
    kind: "MeshInstance3D",
    mesh: "cube",
    children: [(() => {
      const shape = createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" });
      shape.collision = { shape: "convexHull", solid: true };
      return shape;
    })()]
  });
  const ball = (x: number): SceneNode => {
    const node = createSceneNode({ name: "Ball", kind: "CollisionShape3D", transform3D: { position: { x, y: 0, z: 0 } } });
    node.collision = { shape: "sphere", radius: 0.3 };
    return node;
  };
  const fallingBody = (): SceneNode => {
    const shape = createSceneNode({ name: "BodyShape", kind: "CollisionShape3D" });
    shape.collision = { shape: "box", size: { x: 0.5, y: 0.5, z: 0.5 } };
    return createSceneNode({ name: "Body", kind: "Node3D", transform3D: { position: { x: 0, y: 5, z: 0 } }, children: [shape] });
  };

  // Ball and Body are moved directly (not through a script's own logic) to check gs_overlaps, gs_ray_cast and gs_move_and_collide at chosen positions;
  // a node's world transform is only kept in step with gs_node_state at runtime when something marks it "dynamic", so this no-op write is what does that.
  const NO_OP = "func _process(delta):\n    position.x += 0.0\n    position.y += 0.0\n";
  const translated = translateScene3D(scriptedProject([{ name: "Mover", source: NO_OP, attachTo: ["Ball", "Body"] }], [player, ball(0.6), fallingBody()]));
  if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const scene: DsScene3D = { ...translated.scene, scriptCode: `${translated.scene.scriptCode}\n#include "gs_collision.h"\n` };
  expect(translated.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);
  const READY = "gs_collision_reset(); gs_init_nodes(); gs_update_nodes();";

  const cases: Array<{ name: string; setup: string; expr: string; check: (v: number) => void }> = [];
  const add = (name: string, setup: string, expr: string, check: (v: number) => void): void => void cases.push({ name, setup, expr, check });

  // The hull ~= a box from -0.5 to 0.5 on every axis (see the file comment). A sphere of radius 0.3 centered at x = 0.6 reaches to x = 0.3,
  // inside the hull's face at x = 0.5: they overlap. At x = 1.0 it reaches only to x = 0.7, a 0.2 gap short of the face: they don't.
  add("a sphere reaching past the hull's face overlaps it", READY, `gs_overlaps(${index("PlayerShape")}, ${index("Ball")})`, (v) => expect(v).toBe(1));
  add("and clears it once moved 0.4 further out", `${READY} gs_node_state[${index("Ball")}].position[0] = ${F(1.0)};`, `gs_overlaps(${index("PlayerShape")}, ${index("Ball")})`, (v) => expect(v).toBe(0));

  // A ray from well outside the hull, aimed at its center, should meet its near face at x = 0.5 (the ray starts at x = 5, so 4.5 units away). A
  // non-box shape's ray hit is a marched, probe-sized search (see ray_vs_shape's own comment): it converges to a little short of the true surface,
  // within about the probe's own size (0.03 units), not to the exact distance the way a box's ray-vs-box slab test does.
  add(
    "a ray meets the hull's near face at the expected distance",
    READY,
    `gs_ray_cast(${index("Ball")}, ${F(5)}, 0, 0, ${F(-1)}, 0, 0, ${F(20)})`,
    (v) => {
      expect(v / 4096).toBeGreaterThan(4.4);
      expect(v / 4096).toBeLessThanOrEqual(4.5);
    }
  );
  add("and misses when aimed past it", READY, `gs_ray_cast(${index("Ball")}, ${F(5)}, ${F(5)}, 0, ${F(-1)}, 0, 0, ${F(20)})`, (v) => expect(v).toBe(-4096));

  // A solid hull stops a falling body: Body starts well above the hull's top face (y = 0.5) and falls 10 units; it should come to rest on top of
  // it, its own box (half-height 0.25) sitting just above y = 0.5.
  add(
    "a solid hull stops a body falling onto it, at the expected height",
    `${READY} gs_move_and_collide(${index("Body")}, 0, ${F(-10)}, 0);`,
    `gs_node_state[${index("Body")}].position[1]`,
    (v) => expect(v / 4096).toBeGreaterThan(0.7)
  );
  add("(and not right through it)", `${READY} gs_move_and_collide(${index("Body")}, 0, ${F(-10)}, 0);`, `gs_node_state[${index("Body")}].position[1]`, (v) => expect(v / 4096).toBeLessThan(0.8));

  let values: number[] = [];
  beforeAll(async () => {
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup, expr: c.expr }));
    values = (await runDump(scene, items, work, "collision-hull")).values;
  }, 240_000);
  cases.forEach((c, i) => it(c.name, () => c.check(values[i])));
});
