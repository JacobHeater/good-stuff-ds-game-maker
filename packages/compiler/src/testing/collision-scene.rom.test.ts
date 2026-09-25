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
 * `gs_overlaps` on a compiled scene, on the real DS CPU (requirements/collision/TASK.compile-and-run-collision-checks.md): the shapes come from the
 * node table, so they follow what a script does to their nodes (position, scale, visibility, and the nodes they are under) as it happens, in the
 * same frame. The shape-against-shape maths is tested separately (collision.rom.test.ts); this checks the plumbing around it.
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

const at = (x: number, y = 0, z = 0) => ({ position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
const shape = (name: string, collision: SceneNode["collision"], transform = at(0)): SceneNode => {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: transform });
  node.collision = collision;
  return node;
};

/** A script that writes every value the tests change, so every node they touch is dynamic (as it would be in a game that moves them). */
const SOURCE = `func _process(delta):
    $B.position.x = 3.0
    $B.scale.x = 1.0
    $B.visible = true
    $A.rotation.z = 0.0
    $Holder.position.x = 0.0
    $Holder.scale.x = 1.0
    $Holder.visible = true
    if $A.overlaps($B) or $C.overlaps($D) or $C.overlaps($D2):
        pass
`;

describe.skipIf(!toolchain.found)("overlaps() on the nodes of a compiled scene, on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-collision-scene-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let scene: DsScene3D;
  let values: number[] = [];

  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);

  // The state every case starts from; each case then changes some of it (the script's own writes go to the same place).
  const RESET = (i: (name: string) => number): string =>
    `gs_node_state[${i("B")}].position[0] = ${F(3)}; gs_node_state[${i("B")}].scale[0] = ${F(1)}; gs_node_state[${i("B")}].scale[1] = ${F(1)}; gs_node_state[${i("B")}].scale[2] = ${F(1)}; ` +
    `gs_node_state[${i("B")}].visible = 1; gs_node_state[${i("A")}].rotation[2] = 0; gs_node_state[${i("Holder")}].position[0] = 0; ` +
    `gs_node_state[${i("Holder")}].scale[0] = ${F(1)}; gs_node_state[${i("Holder")}].scale[1] = ${F(1)}; gs_node_state[${i("Holder")}].scale[2] = ${F(1)}; gs_node_state[${i("Holder")}].visible = 1;`;

  interface Case {
    name: string;
    expected: number;
    setup: (i: (name: string) => number) => string;
    expr: (i: (name: string) => number) => string;
  }
  const overlapsAB = (i: (name: string) => number): string => `gs_overlaps(${i("A")}, ${i("B")})`;
  const cases: Case[] = [
    { name: "a box and a sphere 3 apart don't overlap", expected: 0, setup: () => "", expr: overlapsAB },
    { name: "moving the sphere to 0.9 makes them overlap, in the same frame the script writes it", expected: 1, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(0.9)};`, expr: overlapsAB },
    { name: "1.1 is just too far", expected: 0, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(1.1)};`, expr: overlapsAB },
    { name: "asking the other way round gives the same answer", expected: 1, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(0.9)};`, expr: (i) => `gs_overlaps(${i("B")}, ${i("A")})` },
    { name: "a hidden shape overlaps nothing", expected: 0, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(0.9)}; gs_node_state[${i("B")}].visible = 0;`, expr: overlapsAB },
    { name: "and does again when shown", expected: 1, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(0.9)}; gs_node_state[${i("B")}].visible = 0; gs_node_state[${i("B")}].visible = 1;`, expr: overlapsAB },
    { name: "the node's own scale scales its shape: the sphere at 1.4 reaches the box once doubled (1.0 + 0.5)", expected: 1, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(1.4)}; gs_node_state[${i("B")}].scale[0] = ${F(2)}; gs_node_state[${i("B")}].scale[1] = ${F(2)}; gs_node_state[${i("B")}].scale[2] = ${F(2)};`, expr: overlapsAB },
    { name: "and not at its own size (0.5 + 0.5 = 1.0 < 1.4)", expected: 0, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(1.4)};`, expr: overlapsAB },
    { name: "the node's rotation turns its shape: the box turned 45 degrees reaches the sphere at 1.15", expected: 1, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(1.15)}; gs_node_state[${i("A")}].rotation[2] = ${F(45)};`, expr: overlapsAB },
    { name: "and doesn't at 1.3", expected: 0, setup: (i) => `gs_node_state[${i("B")}].position[0] = ${F(1.3)}; gs_node_state[${i("A")}].rotation[2] = ${F(45)};`, expr: overlapsAB },
    { name: "a shape under a group overlaps one outside it where they are placed", expected: 1, setup: () => "", expr: (i) => `gs_overlaps(${i("C")}, ${i("D")})` },
    { name: "moving the group moves the shape under it away from the one outside", expected: 0, setup: (i) => `gs_node_state[${i("Holder")}].position[0] = ${F(3)};`, expr: (i) => `gs_overlaps(${i("C")}, ${i("D")})` },
    { name: "and back again", expected: 1, setup: (i) => `gs_node_state[${i("Holder")}].position[0] = ${F(3)}; gs_node_state[${i("Holder")}].position[0] = 0;`, expr: (i) => `gs_overlaps(${i("C")}, ${i("D")})` },
    { name: "two shapes under the same group move together, so they still overlap", expected: 1, setup: (i) => `gs_node_state[${i("Holder")}].position[0] = ${F(3)};`, expr: (i) => `gs_overlaps(${i("C")}, ${i("D3")})` },
    { name: "a parent's scale scales the shapes under it: at 1 a sphere 0.9 clear of the box's face is apart", expected: 0, setup: () => "", expr: (i) => `gs_overlaps(${i("C")}, ${i("D2")})` },
    { name: "doubling the parent doubles the box, and the sphere is now inside reach", expected: 1, setup: (i) => `gs_node_state[${i("Holder")}].scale[0] = ${F(2)}; gs_node_state[${i("Holder")}].scale[1] = ${F(2)}; gs_node_state[${i("Holder")}].scale[2] = ${F(2)};`, expr: (i) => `gs_overlaps(${i("C")}, ${i("D2")})` },
    { name: "hiding a parent hides the shapes under it", expected: 0, setup: (i) => `gs_node_state[${i("Holder")}].visible = 0;`, expr: (i) => `gs_overlaps(${i("C")}, ${i("D")})` },
    { name: "a node with no shape overlaps nothing", expected: 0, setup: () => "", expr: (i) => `gs_overlaps(${i("Cube")}, ${i("A")})` },
    { name: "an index that is not a node overlaps nothing, and neither does -1", expected: 0, setup: () => "", expr: (i) => `gs_overlaps(${i("A")}, 9999) | gs_overlaps(-1, ${i("A")})` },
    { name: "a shape overlaps itself", expected: 1, setup: () => "", expr: (i) => `gs_overlaps(${i("A")}, ${i("A")})` }
  ];

  beforeAll(async () => {
    // C (a box) and D3 (a sphere 0.9 from its middle, 0.4 past its face) are under a group at z = 5; D and D2 (spheres) are outside it, at the same
    // places (z = 5.9 and 6.4), so moving, scaling or hiding the group moves C away from them but keeps C and D3 together.
    const holder = createSceneNode({ name: "Holder", kind: "Node3D", transform3D: at(0, 0, 5), children: [shape("C", { shape: "box" }, at(0)), shape("D3", { shape: "sphere", radius: 0.5 }, at(0, 0, 0.9))] });
    const translated = translateScene3D(
      scriptedProject([{ name: "Collisions", source: SOURCE }], [shape("A", { shape: "box" }), shape("B", { shape: "sphere", radius: 0.5 }, at(3)), holder, shape("D", { shape: "sphere", radius: 0.5 }, at(0, 0, 5.9)), shape("D2", { shape: "sphere", radius: 0.5 }, at(0, 0, 6.4))])
    );
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    scene = { ...translated.scene, scriptCode: translated.scene.scriptCode };
    const items: DumpItem[] = cases.map((c) => ({ setup: `${RESET(index)} ${c.setup(index)}`, expr: c.expr(index) }));
    values = (await runDump(scene, items, work, "collision-scene")).values;
  }, 240_000);

  it("compiled every shape and script-written node the way the tests assume", () => {
    expect(scene.nodes.filter((n) => n.collider >= 0).map((n) => n.name)).toEqual(["A", "B", "C", "D3", "D", "D2"]);
    for (const name of ["A", "B", "Holder", "C", "D3"]) expect(scene.nodes[index(name)].dynamic, name).toBe(true);
    for (const name of ["D", "D2"]) expect(scene.nodes[index(name)].dynamic, name).toBe(false);
    expect(scene.nodes[index("Cube")].collider).toBe(-1);
  });

  cases.forEach((c, i) => {
    it(c.name, () => {
      expect(values[i]).toBe(c.expected);
    });
  });
});
