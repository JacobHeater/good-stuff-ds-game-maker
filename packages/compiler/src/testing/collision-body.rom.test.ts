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
 * move_and_collide on the real DS CPU (requirements/collision/STORY.solid-shapes-and-move-and-collide.md): a body (a player mesh with a shape under it)
 * is moved frame by frame through a small level of solid boxes, and where it ends up and what it ran into are read back. The overlap test underneath is
 * checked separately (collision.rom.test.ts).
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);
const ORIGIN = { x: 0, y: 0, z: 0 };

const shape = (name: string, size: [number, number, number], position: [number, number, number], solid = true, visible = true): SceneNode => {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position: { x: position[0], y: position[1], z: position[2] }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  node.collision = { shape: "box", size: { x: size[0], y: size[1], z: size[2] }, solid };
  node.visible = visible;
  return node;
};

const round = (name: string, kind: "sphere" | "capsule", position: [number, number, number]): SceneNode => {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position: { x: position[0], y: position[1], z: position[2] }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  node.collision = kind === "sphere" ? { shape: "sphere", size: { x: 1, y: 1, z: 1 }, radius: 1, height: 2, solid: true } : { shape: "capsule", size: { x: 1, y: 1, z: 1 }, radius: 0.5, height: 2, solid: true };
  return node;
};

/** The level. The floor's top is at y = 0; the player is a unit box. */
function level(): SceneNode[] {
  const player = createSceneNode({ name: "Player", kind: "MeshInstance3D", mesh: "cube", children: [shape("PlayerShape", [1, 1, 1], [0, 0, 0], true)], transform3D: { position: { x: 0, y: 3, z: 0 }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  return [
    player,
    shape("Floor", [10, 1, 30], [0, -0.5, 0]), //                x -5..5, z -15..15
    shape("Wall", [1, 3, 10], [3, 1.5, 0]), //                  x 2.5..3.5, y 0..3
    shape("Floor2", [3, 1, 10], [6.5, -0.5, 0]), //             x 5..8
    shape("Ceiling", [3, 1, 10], [6.5, 4.5, 0]), //             underside at y = 4, over Floor2
    shape("ThinFloor", [4, 0.1, 4], [20, -0.05, 0]), //         a floor 0.1 thick
    shape("Platform", [2, 1, 2], [30, -0.5, 0]), //             x 29..31, nothing beyond it
    shape("LongPlatform", [4, 1, 8], [200, -0.5, 0]), //        x 198..202, z -4..4
    // A block whose shape is longer in Z than in X, its shape lifted 0.5 off its origin (as a Jenga block's is), standing with its length hanging over the platform's z = 4 edge.
    createSceneNode({ name: "LongBlock", kind: "MeshInstance3D", mesh: "cube", children: [shape("LongShape", [1, 1, 3], [0, 0.5, 0], true)], transform3D: { position: { x: 200, y: 0, z: 3.2 }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } }),
    shape("Hidden", [4, 2, 1], [0, 1, 6], true, false), //      a solid shape that is hidden: a door that is open
    shape("NonSolid", [4, 2, 1], [0, 1, -4], false), //         a shape that is not solid: nothing stops on it
    round("Ball", "sphere", [60, 1, 0]), //                        a solid sphere of radius 1: what a ray meets that isn't a box
    round("Pill", "capsule", [60, 1, 10]), //                      a solid capsule of radius 0.5, standing (height 2)
    // A tower's worth of solid blocks (5 x 10 unit boxes, tops at y = 1) well away from the rest: what a Jenga game asks each call to sift through.
    ...Array.from({ length: 50 }, (_, i) => shape(`Block${i}`, [1, 1, 1], [40 + (i % 5), 0.5, Math.floor(i / 5)]))
  ];
}
const SCRIPT = `func _process(delta):
    move_and_collide(0.0, 0.0, 0.0)
    $Hidden.visible = false
`;

describe.skipIf(!toolchain.found)("move_and_collide on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-collision-body-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let scene: DsScene3D;
  let values: number[] = [];
  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);
  const P = (): string => `gs_node_state[${index("Player")}].position`;

  /** C for a scenario: the player at (x, y, z), then `frames` frames each moving by (dx, dy, dz) (f32 expressions), remembering where it ended, the flags and the last frames' heights. */
  const run = (start: [number, number, number], frames: number, move: string, extra = ""): string => `
    ${P()}[0] = ${F(start[0])}; ${P()}[1] = ${F(start[1])}; ${P()}[2] = ${F(start[2])};
    gs_node_state[${index("Hidden")}].visible = 0;
    ${extra}
    int32_t blocked = 0, lowest = 0x7fffffff, highest = -0x7fffffff, firstFloor = -1;
    for (int f = 0; f < ${frames}; f++) {
      blocked = gs_move_and_collide(${index("Player")}, ${move});
      int32_t y = ${P()}[1];
      if (f >= ${frames} - 30) { if (y < lowest) lowest = y; if (y > highest) highest = y; }
      if (firstFloor < 0 && gs_body_state(${index("Player")}, GS_BODY_FLOOR)) firstFloor = f;
    }
    int32_t flags = gs_body_state(${index("Player")}, GS_BODY_FLOOR) | (gs_body_state(${index("Player")}, GS_BODY_WALL) << 1) | (gs_body_state(${index("Player")}, GS_BODY_CEILING) << 2);`;
  const FALL = `0, ${F(-0.33)}, 0`;

  interface Case {
    name: string;
    setup: string;
    expr: string;
    check: (value: number) => void;
  }
  const cases: Case[] = [];
  const add = (name: string, setup: () => string, expr: string, check: (value: number) => void): void => {
    cases.push({ name, setup: "", expr, check });
    lazy.push(setup);
  };
  const lazy: Array<() => string> = [];
  const between = (low: number, high: number) => (v: number): void => {
    expect(v / 4096, `got ${v / 4096}`).toBeGreaterThanOrEqual(low);
    expect(v / 4096, `got ${v / 4096}`).toBeLessThanOrEqual(high);
  };
  const REST = 0.5; // a unit box on a floor whose top is at 0

  // ---- Floors.
  add("falling onto the floor: the body ends up resting on top of it (its half height 0.5, plus the small gap)", () => run([0, 3, 0], 120, FALL), `${"P"}`, between(REST, REST + 0.03));
  add("and is_on_floor() is true", () => run([0, 3, 0], 120, FALL), "flags & 1", (v) => expect(v).toBe(1));
  add("resting, it doesn't sink or jitter: its height is the same for the last 30 frames", () => run([0, 3, 0], 120, FALL), "highest - lowest", (v) => expect(v).toBe(0));
  add("a fall of 6 units in one call lands on the floor instead of passing through it", () => run([0, 6.5, 0], 1, `0, ${F(-6)}, 0`), `${"P"}`, between(REST, REST + 0.03));
  add("even through a floor only 0.1 thick", () => run([20, 6.5, 0], 1, `0, ${F(-6)}, 0`), `${"P"}`, between(REST, REST + 0.03));
  add("a move that is stopped returns 1, and one that isn't returns 0", () => run([0, 3, 0], 1, `0, ${F(-0.1)}, 0`), "blocked", (v) => expect(v).toBe(0));
  add("falling with nothing to hit is not floor, wall or ceiling", () => run([0, 3, 0], 1, `0, ${F(-0.1)}, 0`), "flags", (v) => expect(v).toBe(0));
  add("the first frame it is on the floor is when it reaches it (from 3 units up at 0.33 a frame, about frame 7)", () => run([0, 3, 0], 40, FALL), "firstFloor", (v) => {
    expect(v).toBeGreaterThanOrEqual(6);
    expect(v).toBeLessThanOrEqual(9);
  });
  // ---- Walking.
  add("walking on the floor: 30 frames at 0.05 goes 1.5 units, gravity still holding it down", () => run([0, 0.51, 0], 30, `${F(0.05)}, ${F(-0.33)}, 0`), "gs_node_state[" + "PX" + "]", between(1.45, 1.51));
  add("walking keeps it on the floor (is_on_floor() true, height unchanged)", () => run([0, 0.51, 0], 30, `${F(0.05)}, ${F(-0.33)}, 0`), "flags & 1", (v) => expect(v).toBe(1));
  // ---- Walls.
  add("walking into the wall stops it against the wall (its face at 2.5, half width 0.5: x about 2)", () => run([1.5, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, 0`), "gs_node_state[" + "PX" + "]", between(1.97, 2.0));
  add("and is_on_wall() and is_on_floor() are both true", () => run([1.5, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, 0`), "flags", (v) => expect(v).toBe(3));
  add("moving diagonally into the wall slides along it: x stops but z keeps going (60 frames of 0.05 = 3 units)", () => run([1.9, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, ${F(0.05)}`), "gs_node_state[" + "PZ" + "]", between(2.9, 3.01));
  add("and x stayed at the wall", () => run([1.9, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, ${F(0.05)}`), "gs_node_state[" + "PX" + "]", between(1.97, 2.0));
  add("a wall stops a fast sideways move too: 5 units in one call", () => run([0, 0.51, 0], 1, `${F(5)}, 0, 0`), "gs_node_state[" + "PX" + "]", between(1.97, 2.0));
  // ---- Edges.
  add("walking off the edge of a platform: it falls (is_on_floor() false at the end)", () => run([30.9, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, 0`), "flags & 1", (v) => expect(v).toBe(0));
  add("and keeps falling: after 60 frames it is far below", () => run([30.9, 0.51, 0], 60, `${F(0.05)}, ${F(-0.33)}, 0`), `${"P"}`, (v) => expect(v / 4096).toBeLessThan(-5));
  // ---- Ceilings.
  add("moving up into a ceiling stops it under it (underside at 4, half height 0.5: y about 3.5)", () => run([6.5, 0.51, 0], 20, `0, ${F(0.3)}, 0`), `${"P"}`, between(3.45, 3.5));
  add("and is_on_ceiling() is true, is_on_floor() false", () => run([6.5, 0.51, 0], 20, `0, ${F(0.3)}, 0`), "flags", (v) => expect(v).toBe(4));
  add("a jump that clears nothing above goes as far as asked", () => run([0, 0.51, 0], 10, `0, ${F(0.3)}, 0`), `${"P"}`, between(3.4, 3.6));
  // ---- What does not stop a body.
  add("a hidden solid shape doesn't block: the body walks through it (z from 4 to 7 past the shape at z 6)", () => run([0, 0.51, 4], 60, `0, ${F(-0.33)}, ${F(0.05)}`), "gs_node_state[" + "PZ" + "]", between(6.9, 7.1));
  add("shown, it blocks: the body stops against it (z about 5)", () => run([0, 0.51, 4], 60, `0, ${F(-0.33)}, ${F(0.05)}`, `gs_node_state[${index("Hidden")}].visible = 1;`), "gs_node_state[" + "PZ" + "]", between(4.9, 5.0));
  add("a shape that is not solid doesn't block: the body walks through it (z from -2 to -5)", () => run([0, 0.51, -2], 60, `0, ${F(-0.33)}, ${F(-0.05)}`), "gs_node_state[" + "PZ" + "]", between(-5.1, -4.9));
  add("the body's own shape, though solid, doesn't stop the body (it fell to the floor above)", () => run([0, 3, 0], 60, FALL), "flags & 1", (v) => expect(v).toBe(1));
  // ---- Starting inside.
  add("a body inside a solid shape doesn't sink further into it: a move down that would stay inside is refused (0.2 stays 0.2)", () => run([0, 0.2, 0], 1, `0, ${F(-0.1)}, 0`), `${"P"}`, (v) => expect(v).toBe(F(0.2)));
  add("and a move sideways that would stay inside is refused too", () => run([0, 0.2, 0], 1, `${F(0.1)}, 0, 0`), "gs_node_state[" + "PX" + "]", (v) => expect(v).toBe(0));
  add("but a move up is free, so it can climb out (0.2 up by 0.1 twice is 0.4)", () => run([0, 0.2, 0], 2, `0, ${F(0.1)}, 0`), `${"P"}`, (v) => expect(v).toBe(F(0.2) + 2 * F(0.1)));
  add("a move that ends clear of it gets out (0.2 up by 0.6 is 0.8)", () => run([0, 0.2, 0], 1, `0, ${F(0.6)}, 0`), `${"P"}`, (v) => expect(v).toBe(F(0.8)));
  // ---- Move order and axes.
  add("a zero move changes nothing and reports nothing", () => run([0, 0.51, 0], 1, "0, 0, 0"), "blocked | flags", (v) => expect(v).toBe(0));

  // ---- probe_solid: which of three points under the body (in its own frame) are inside a solid shape. The probe looks 0.56 below the centre: 0.06 under the body's underside.
  const at = (x: number, y: number, z: number, yaw = 0): string => `
    ${P()}[0] = ${F(x)}; ${P()}[1] = ${F(y)}; ${P()}[2] = ${F(z)}; gs_node_state[${index("Player")}].rotation[1] = ${F(yaw)};
    gs_node_state[${index("Hidden")}].visible = 0;`;
  const probe = (y: number, x0: number, x1: number, x2: number, body = "#PLAYER#"): string =>
    `({ int32_t held = gs_probe_solid(${body}, ${F(y)}, ${F(x0)}, ${F(x1)}, ${F(x2)}); gs_node_state[#PLAYER#].rotation[1] = 0; held; })`;
  add("probe_solid on the floor: all three points under the body are held (1 + 2 + 4)", () => at(0, 0.51, 0), probe(-0.56, -1, 0, 1), (v) => expect(v).toBe(7));
  add("probe_solid in the air: nothing under the body, and its own solid shape doesn't count", () => at(0, 3, 0), probe(-0.56, -1, 0, 1), (v) => expect(v).toBe(0));
  add("probe_solid with the right end over the edge of a platform: the left point and the middle are held (1 + 2)", () => at(30.8, 0.51, 0), probe(-0.56, -0.8, 0, 0.8), (v) => expect(v).toBe(3));
  add("probe_solid with the left end over the edge: the middle and the right point are held (2 + 4)", () => at(29.2, 0.51, 0), probe(-0.56, -0.8, 0, 0.8), (v) => expect(v).toBe(6));
  add("probe_solid follows the body's turn: turned a quarter about Y its length runs along Z, so the same points land elsewhere (2 + 4)", () => at(30, 0.51, 0.8, 90), probe(-0.56, -0.8, 0, 0.8), (v) => expect(v).toBe(6));
  add(
    "probe_solid on a block whose shape is longer in Z (and lifted off its origin) is taken from the shape's centre along Z: 0.56 below it, at z -1, 0, +1 from 3.2 is 2.2, 3.2 and 4.2, so the last is over the edge (1 + 2)",
    () => at(0, 3, 0),
    probe(-0.56, -1, 0, 1, "#LONG#"),
    (v) => expect(v).toBe(3)
  );
  add("probe_solid looks only as far below as asked: 0.2 below the centre is inside the body, not the floor", () => at(0, 0.51, 0), probe(-0.2, -1, 0, 1), (v) => expect(v).toBe(0));

  // ---- ray_cast: how far along a ray to the nearest visible solid shape that isn't under the body. Distances are in world units; -1 is "nothing within reach".
  const ray = (o: [number, number, number], d: [number, number, number], max: number): string =>
    `({ int32_t hit = gs_ray_cast(#PLAYER#, ${F(o[0])}, ${F(o[1])}, ${F(o[2])}, ${F(d[0])}, ${F(d[1])}, ${F(d[2])}, ${F(max)}); hit; })`;
  const none = (v: number): void => expect(v, `got ${v / 4096}`).toBe(-4096);
  add("ray_cast straight down from inside the body: its own shape is ignored and the floor's top is 3 below", () => at(0, 3, 0), ray([0, 3, 0], [0, -1, 0], 10), between(2.99, 3.01));
  add("ray_cast sideways at the wall's face (x = 2.5) from x = 0 is 2.5, and the direction needn't be a unit vector (3, 0, 0)", () => at(0, 3, 0), ray([0, 1, 0], [3, 0, 0], 10), between(2.49, 2.51));
  add("ray_cast reaches only as far as max: the same ray with max 2 hits nothing", () => at(0, 3, 0), ray([0, 1, 0], [1, 0, 0], 2), none);
  add("ray_cast with nothing in the way (straight up) hits nothing", () => at(0, 3, 0), ray([0, 1, 0], [0, 1, 0], 20), none);
  add("ray_cast at a slant: (1, -0.2, 0) meets the wall's face at 2.5 / cos = 2.55", () => at(0, 3, 0), ray([0, 1, 0], [1, -0.2, 0], 10), between(2.54, 2.56));
  add("ray_cast over the wall's top misses it (going up and across)", () => at(0, 3, 0), ray([0, 1, 0], [1, 1, 0], 10), none);
  add("ray_cast passes through a hidden solid shape", () => at(0, 3, 0), ray([0, 1, 3], [0, 0, 1], 10), none);
  add("ray_cast hits it when it is shown (from the next frame on, as the shapes are taken as placed at the frame's start; its near face is at z = 5.5, 2.5 from z = 3)", () => at(0, 3, 0) + `gs_node_state[${index("Hidden")}].visible = 1; gs_update_nodes();`, ray([0, 1, 3], [0, 0, 1], 10), between(2.49, 2.51));
  add("ray_cast passes through a shape that is not solid", () => at(0, 3, 0), ray([0, 1, -2], [0, 0, -1], 10), none);
  add("ray_cast from inside a solid shape hits it at once (0)", () => at(0, 3, 0), ray([0, -0.5, 0], [1, 0, 0], 10), (v) => expect(v).toBe(0));
  add("ray_cast at a solid sphere (radius 1 at x = 60) from x = 55: its surface is 4 away (found within 0.03)", () => at(0, 3, 0), ray([55, 1, 0], [1, 0, 0], 10), between(3.93, 4.02));
  add("ray_cast at a sphere it passes beside misses", () => at(0, 3, 0), ray([55, 2.5, 0], [1, 0, 0], 10), none);
  add("ray_cast at a solid capsule (radius 0.5 at z = 10) from z = 5 along Z: its side is 4.5 away", () => at(0, 3, 0), ray([60, 1, 5], [0, 0, 1], 10), between(4.42, 4.52));
  add("ray_cast takes the nearest of several shapes: from x = 0 along +X at y 1 the wall (2.5) comes before Floor2 and the ball", () => at(0, 3, 0), ray([0, 1, 0], [1, 0, 0], 100), between(2.49, 2.51));

  // ---- What it costs, per call, on the DS's timer (33.5 MHz).
  const timed = (start: [number, number, number], frames: number, move: string): string => `
    ${P()}[0] = ${F(start[0])}; ${P()}[1] = ${F(start[1])}; ${P()}[2] = ${F(start[2])};
    gs_node_state[${index("Hidden")}].visible = 0;
    uint32_t total = 0, slowest = 0;
    for (int f = 0; f < ${frames}; f++) {
      cpuStartTiming(0);
      gs_move_and_collide(${index("Player")}, ${move});
      uint32_t ticks = cpuEndTiming();
      total += ticks;
      if (ticks > slowest) slowest = ticks;
    }`;
  const timedProbe = (start: [number, number, number]): string => `
    ${P()}[0] = ${F(start[0])}; ${P()}[1] = ${F(start[1])}; ${P()}[2] = ${F(start[2])};
    gs_node_state[${index("Hidden")}].visible = 0;
    uint32_t total = 0, slowest = 0;
    for (int f = 0; f < 60; f++) {
      cpuStartTiming(0);
      gs_probe_solid(${index("Player")}, ${F(-0.56)}, ${F(-1)}, 0, ${F(1)});
      uint32_t ticks = cpuEndTiming();
      total += ticks;
      if (ticks > slowest) slowest = ticks;
    }`;
  const timedRay = (origin: [number, number, number], dir: [number, number, number], max: number): string => `
    ${P()}[0] = ${F(0)}; ${P()}[1] = ${F(3)}; ${P()}[2] = ${F(0)};
    gs_node_state[${index("Hidden")}].visible = 0;
    uint32_t total = 0, slowest = 0;
    for (int f = 0; f < 60; f++) {
      cpuStartTiming(0);
      gs_ray_cast(${index("Player")}, ${F(origin[0])}, ${F(origin[1])}, ${F(origin[2])}, ${F(dir[0])}, ${F(dir[1])}, ${F(dir[2])}, ${F(max)});
      uint32_t ticks = cpuEndTiming();
      total += ticks;
      if (ticks > slowest) slowest = ticks;
    }`;
  const timings: Array<{ name: string; setup: () => string; average: string; slowest: string }> = [
    { name: "ray: at a wall, 60 solid shapes", setup: () => timedRay([0, 1, 0], [1, 0, 0], 20), average: "total / 60", slowest: "slowest" },
    { name: "ray: at a capsule (marched)", setup: () => timedRay([60, 1, 0], [0, 0, 1], 20), average: "total / 60", slowest: "slowest" },
    { name: "falling in the air (nothing near)", setup: () => timed([12, 30, 0], 60, `0, ${F(-0.1)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "standing on the floor with gravity", setup: () => timed([0, 0.51, 0], 60, `0, ${F(-0.0055)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "walking on the floor", setup: () => timed([-3, 0.51, 0], 60, `${F(0.03)}, ${F(-0.0055)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "pressed against a wall", setup: () => timed([2, 0.51, 0], 60, `${F(0.05)}, ${F(-0.0055)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "move: resting on a 50-block tower", setup: () => timed([42, 1.51, 5], 60, `0, ${F(-0.0055)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "move: in the air, tower far away", setup: () => timed([12, 30, 0], 60, `0, ${F(-0.1)}, 0`), average: "total / 60", slowest: "slowest" },
    { name: "probe: over a 50-block tower", setup: () => timedProbe([42, 1.51, 5]), average: "total / 60", slowest: "slowest" },
    { name: "probe: in the air, tower far away", setup: () => timedProbe([12, 30, 0]), average: "total / 60", slowest: "slowest" }
  ];

  beforeAll(async () => {
    const translated = translateScene3D(scriptedProject([{ name: "Body", source: SCRIPT, attachTo: ["Player"] }], level()));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    scene = translated.scene;
    const P0 = `gs_node_state[${index("Player")}].position[1]`;
    const items: DumpItem[] = cases.map((c, i) => ({
      setup: lazy[i](),
      expr: c.expr.replaceAll("#PLAYER#", String(index("Player"))).replaceAll("#LONG#", String(index("LongBlock"))).replace("gs_node_state[PX]", `gs_node_state[${index("Player")}].position[0]`).replace("gs_node_state[PZ]", `gs_node_state[${index("Player")}].position[2]`).replace("P", P0)
    }));
    for (const t of timings) items.push({ setup: t.setup(), expr: t.average }, { setup: t.setup(), expr: t.slowest });
    values = (await runDump(scene, items, work, "collision-body", 40)).values;
  }, 300_000);

  it("compiled the level with the player and its shape as moving nodes and the ground as still ones", () => {
    const dynamic = (name: string) => scene.nodes[index(name)].dynamic;
    expect([dynamic("Player"), dynamic("PlayerShape"), dynamic("Floor"), dynamic("Wall")]).toEqual([true, true, false, false]);
    expect(scene.colliders.filter((c) => c.solid)).toHaveLength(62);
  });

  cases.forEach((c, i) => {
    it(c.name, () => c.check(values[i]));
  });

  it("takes well under a frame's time per call, standing, walking or pressed against a wall", () => {
    const TICKS_PER_MS = 33513;
    const results = timings.map((t, i) => ({ name: t.name, average: values[cases.length + i * 2], slowest: values[cases.length + i * 2 + 1] }));
    console.info(
      "move_and_collide cost on the DS (33513 timer ticks = 1 ms), one body shape against 58 solid shapes:\n" +
        results.map((r) => `  ${r.name.padEnd(36)} average ${String(r.average).padStart(6)} (${(r.average / TICKS_PER_MS).toFixed(2)} ms), slowest ${String(r.slowest).padStart(6)} (${(r.slowest / TICKS_PER_MS).toFixed(2)} ms)`).join("\n")
    );
    for (const r of results) {
      expect(r.average, `${r.name} averages ${r.average} ticks`).toBeGreaterThan(0);
      expect(r.average, `${r.name} averages ${r.average} ticks`).toBeLessThan(TICKS_PER_MS * 6);
    }
  });
});
