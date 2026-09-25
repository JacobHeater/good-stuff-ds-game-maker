import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * The example player script (tests/prototypes/scripts/player-jump.gsscript) run frame by frame on the DS in a small level of solid shapes: walking,
 * jumping, gravity, landing on the floor and on a step, walls, ceilings, no double jump. The script's own `_process` is called 60 frames a second (delta 68,
 * as the runtime gives it) with buttons set the way a player would press them, and the player's position is read after each frame.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../../../../tests/prototypes/scripts/player-jump.gsscript"), "utf-8");
const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);
const DELTA = 68; // 1/60 s in 20.12, what the runtime passes at 60 frames a second
const ORIGIN = { x: 0, y: 0, z: 0 };

const solid = (name: string, size: [number, number, number], position: [number, number, number]): SceneNode => {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position: { x: position[0], y: position[1], z: position[2] }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  node.collision = { shape: "box", size: { x: size[0], y: size[1], z: size[2] }, solid: true };
  return node;
};
function level(): SceneNode[] {
  const shape = createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" }); // a unit box
  const player = createSceneNode({ name: "Player", kind: "MeshInstance3D", mesh: "cube", children: [shape], transform3D: { position: { x: 0, y: 3, z: 0 }, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  return [
    player,
    solid("Floor", [40, 1, 20], [0, -0.5, 0]), //        the ground, top at y = 0, x -20..20
    solid("Step", [2.5, 1, 10], [2.75, 0.5, 0]), //      a step 1 high, x 1.5..4
    solid("Wall", [1, 6, 10], [8, 3, 0]), //             a wall, x 7.5..8.5
    solid("Ceiling", [5, 1, 10], [-6.5, 3, 0]) //        a low ceiling, underside at y = 2.5, x -9..-4
  ];
}

const REST = 0.5; // a unit box standing on ground whose top is at 0

/** A scenario in C: the player starts at (x, y, z) with no speed, then `frames` frames run with the buttons `keys` sets each frame (from the frame number `f`). */
const run = (index: (name: string) => number, start: [number, number, number], frames: number, keys: string): string => `
  gs_node_state[${index("Player")}].position[0] = ${F(start[0])}; gs_node_state[${index("Player")}].position[1] = ${F(start[1])}; gs_node_state[${index("Player")}].position[2] = ${F(start[2])};
  gss0_state[0].m_velocity_y = 0;
  int32_t top = ${F(start[1])}, lastAir = -1, firstAir = -1, lowest = 0x7fffffff, highest = -0x7fffffff;
  for (int f = 0; f < ${frames}; f++) {
    gs_keys_held = 0; gs_keys_pressed = 0; gs_keys_released = 0;
    ${keys}
    gss0__process(0, ${DELTA});
    int32_t y = gs_node_state[${index("Player")}].position[1];
    if (y > top) top = y;
    if (f >= ${frames} - 30) { if (y < lowest) lowest = y; if (y > highest) highest = y; }
    if (!gs_body_state(${index("Player")}, GS_BODY_FLOOR)) { lastAir = f; if (firstAir < 0) firstAir = f; }
  }`;

describe.skipIf(!toolchain.found)("the example player script on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-player-script-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let values: number[] = [];
  let scene: DsScene3D;
  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);
  const X = (): string => `gs_node_state[${index("Player")}].position[0]`;
  const Y = (): string => `gs_node_state[${index("Player")}].position[1]`;

  const HOLD = (button: string): string => `gs_keys_held = GS_KEY_${button};`;
  const PRESS_A_AT = (frames: number[]): string => frames.map((n) => `if (f == ${n}) { gs_keys_pressed = GS_KEY_A; gs_keys_held |= GS_KEY_A; }`).join(" ");
  const SETTLE = 60; // frames to fall and come to rest before a scenario starts pressing buttons

  interface Item {
    name: string;
    setup: () => string;
    expr: () => string;
    check: (value: number) => void;
  }
  const items: Item[] = [];
  const add = (name: string, setup: () => string, expr: () => string, check: (value: number) => void): void => void items.push({ name, setup, expr, check });
  const between = (low: number, high: number) => (v: number): void => {
    expect(v / 4096, `got ${v / 4096}`).toBeGreaterThanOrEqual(low);
    expect(v / 4096, `got ${v / 4096}`).toBeLessThanOrEqual(high);
  };
  /** Starts 1.2 up above the floor at x: it falls and comes to rest during the settle frames, then `frames` more run with `keys` (whose `f` counts from 0 after settling). */
  const rest = (x: number, frames: number, keys: string) => (): string => run(index, [x, 1.2, 0], SETTLE + frames, `if (f >= ${SETTLE}) { int f0 = f - ${SETTLE}; (void)f0; ${keys.replace(/\bf\b/g, "f0")} }`);

  // ---- Standing.
  add("dropped 1 unit above the floor it lands and stands: resting on top of it", rest(0, 60, ""), () => Y(), between(REST, REST + 0.03));
  add("and is_on_floor() is true while standing", rest(0, 60, ""), () => `gs_body_state(${index("Player")}, GS_BODY_FLOOR)`, (v) => expect(v).toBe(1));
  add("its height doesn't change at all over the last 30 frames of standing (no sinking, no jitter)", rest(0, 60, ""), () => "highest - lowest", (v) => expect(v).toBe(0));
  // ---- Walking.
  add("holding Right for a second walks about 3 units right (3 a second)", rest(-3, 60, HOLD("RIGHT")), () => `${X()} - ${F(-3)}`, between(2.9, 3.01));
  add("holding Left walks left the same way", rest(-3, 60, HOLD("LEFT")), () => `${X()} - ${F(-3)}`, between(-3.01, -2.9));
  add("Left and Right together cancel out", rest(-3, 60, "gs_keys_held = GS_KEY_LEFT | GS_KEY_RIGHT;"), () => `${X()} - ${F(-3)}`, (v) => expect(v).toBe(0));
  add("walking on the floor keeps it at the same height", rest(-3, 60, HOLD("RIGHT")), () => "highest - lowest", (v) => expect(v).toBe(0));
  // ---- Jumping.
  add("a jump goes up about 2 units, a little under (9 * 9 / 40 = 2.03, less with a frame's steps): the top is about 0.5 + 1.95", rest(-3, 120, PRESS_A_AT([0])), () => "top", between(2.35, 2.55));
  add("and it lands back at the height it took off from", rest(-3, 120, PRESS_A_AT([0])), () => Y(), between(REST, REST + 0.03));
  add("the jump lasts about 0.9 s: it is off the floor until about frame 55 after the press", rest(-3, 120, PRESS_A_AT([0])), () => "lastAir", (v) => {
    expect(v).toBeGreaterThanOrEqual(SETTLE + 48);
    expect(v).toBeLessThanOrEqual(SETTLE + 60);
  });
  add("pressing A does nothing in the air: presses at frames 20 and 30 don't go higher (no double jump)", rest(-3, 120, PRESS_A_AT([0, 20, 30])), () => "top", between(2.35, 2.55));
  add("holding A down jumps once, not over and over", rest(-3, 180, `gs_keys_held = GS_KEY_A; if (f == 0) gs_keys_pressed = GS_KEY_A;`), () => "lastAir", (v) => expect(v).toBeLessThanOrEqual(SETTLE + 60));
  add("a press just after landing jumps again", rest(-3, 200, PRESS_A_AT([0, 62])), () => "lastAir", (v) => expect(v).toBeGreaterThanOrEqual(SETTLE + 100));
  add("no jump without pressing A", rest(-3, 120, ""), () => "top", between(1.19, 1.21));
  // ---- The level.
  add("jumping while holding Right from x = 0 (released after the landing) lands on the step (its top at 1): about 1.5 up, on the step", rest(0, 120, `if (f < 62) { ${HOLD("RIGHT")} } ${PRESS_A_AT([0])}`), () => Y(), between(1.5, 1.53));
  add("and it is over the step, not beside it: x is past the step's left edge (1.5)", rest(0, 120, `if (f < 62) { ${HOLD("RIGHT")} } ${PRESS_A_AT([0])}`), () => X(), (v) => expect(v / 4096).toBeGreaterThan(1.5));
  add("walking into the side of the step is stopped by it (the step's face at 1.5, half width 0.5: x about 1)", rest(-1, 120, HOLD("RIGHT")), () => X(), between(0.96, 1.01));
  add("walking into the wall is stopped by it (a wall face at 7.5: x about 7)", rest(5, 120, HOLD("RIGHT")), () => X(), between(6.9, 7.0));
  add("a low ceiling stops a jump: the head bumps the underside at 2.5 (center at 2.0), well short of a full jump", rest(-6.5, 120, PRESS_A_AT([0])), () => "top", between(1.9, 2.0));
  add("and it falls back down after bumping and stands again", rest(-6.5, 120, PRESS_A_AT([0])), () => Y(), between(REST, REST + 0.03));
  add("walking off the edge of the step drops onto the floor again", rest(3.5, 120, HOLD("RIGHT")), () => Y(), (v) => expect(v / 4096).toBeLessThan(1.6));

  beforeAll(async () => {
    const translated = translateScene3D(scriptedProject([{ name: "Player", source: SOURCE, attachTo: ["Player"] }], level()));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(translated.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    scene = translated.scene;
    const dump: DumpItem[] = items.map(({ setup, expr }) => ({ setup: setup(), expr: expr() }));
    values = (await runDump(scene, dump, work, "player-script", 60)).values;
  }, 400_000);

  it("compiles with the player and its shape as moving nodes, the ground as still ones, and no warnings", () => {
    expect(scene.nodes.find((n) => n.name === "Player")!.dynamic).toBe(true);
    expect(scene.nodes.find((n) => n.name === "PlayerShape")!.dynamic).toBe(true);
    expect(scene.nodes.find((n) => n.name === "Floor")!.dynamic).toBe(false);
  });

  items.forEach((item, i) => {
    it(item.name, () => item.check(values[i]));
  });
});
