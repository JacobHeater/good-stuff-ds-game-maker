import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * The example 8-way movement script (tests/prototypes/scripts/move-8way.gsscript) run frame by frame on the DS: 60 frames (one second) of `_process` with the
 * D-pad set the way a player would hold it, then the player's position and facing are read. Rotation and position are 20.12 fixed point.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../../../../tests/prototypes/scripts/move-8way.gsscript"), "utf-8");
const toolchain = await new NodeToolchainLocator().locate();
const DELTA = 68; // 1/60 s in 20.12, what the runtime passes at 60 frames a second

describe.skipIf(!toolchain.found)("the example 8-way movement script on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-move-8way-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let values: number[] = [];
  let scene: DsScene3D;
  const index = (): number => scene.nodes.findIndex((n) => n.name === "Player");
  const P = (c: number): string => `gs_node_state[${index()}].position[${c}]`;
  const R = (): string => `gs_node_state[${index()}].rotation[1]`;

  /** The player starts at the origin facing 0, and `frames` frames run with `keys` held. */
  const hold = (keys: string, frames = 60) => (): string => `
    gs_node_state[${index()}].position[0] = 0; gs_node_state[${index()}].position[1] = 0; gs_node_state[${index()}].position[2] = 0;
    gs_node_state[${index()}].rotation[1] = 0;
    for (int f = 0; f < ${frames}; f++) {
      gs_keys_held = ${keys}; gs_keys_pressed = 0; gs_keys_released = 0;
      gss0__process(0, ${DELTA});
    }`;

  interface Item {
    name: string;
    setup: () => string;
    expr: () => string;
    check: (value: number) => void;
  }
  const items: Item[] = [];
  const add = (name: string, setup: () => string, expr: () => string, check: (value: number) => void): void => void items.push({ name, setup, expr, check });
  const near = (want: number, tolerance: number) => (v: number): void => expect(Math.abs(v / 4096 - want), `got ${v / 4096}, wanted ${want}`).toBeLessThanOrEqual(tolerance);

  // One second at speed 3 (60 frames of 68/4096 s is 0.9961 s, so about 2.99).
  add("Right for a second walks about 3 units along +X", hold("GS_KEY_RIGHT"), () => P(0), near(2.99, 0.03));
  add("and does not move on Z or Y", hold("GS_KEY_RIGHT"), () => `${P(1)} | ${P(2)}`, (v) => expect(v).toBe(0));
  add("Left walks along -X", hold("GS_KEY_LEFT"), () => P(0), near(-2.99, 0.03));
  add("Up walks away from the camera, along -Z", hold("GS_KEY_UP"), () => P(2), near(-2.99, 0.03));
  add("Down walks toward the camera, along +Z", hold("GS_KEY_DOWN"), () => P(2), near(2.99, 0.03));
  add("Left and Right together cancel out, and the player stays where it was", hold("GS_KEY_LEFT | GS_KEY_RIGHT"), () => `${P(0)} | ${P(2)}`, (v) => expect(v).toBe(0));
  add("Up and Down together cancel out the same way", hold("GS_KEY_UP | GS_KEY_DOWN"), () => `${P(0)} | ${P(2)}`, (v) => expect(v).toBe(0));
  add("Up+Right walks diagonally: X moves 2.11 (3 / sqrt 2)", hold("GS_KEY_UP | GS_KEY_RIGHT"), () => P(0), near(2.11, 0.03));
  add("and Z moves -2.11 the same amount", hold("GS_KEY_UP | GS_KEY_RIGHT"), () => P(2), near(-2.11, 0.03));
  // The value is X squared plus Z squared in units of 1/256 (each coordinate taken in sixteenths); a straight second covers 2.99 units, 8.94 squared.
  add("so a diagonal covers no more ground than a straight line: the distance from the start is about 3 (X squared plus Z squared is about 9, not 18)", hold("GS_KEY_DOWN | GS_KEY_LEFT"), () => `((${P(0)} >> 8) * (${P(0)} >> 8) + (${P(2)} >> 8) * (${P(2)} >> 8))`, (v) => expect(Math.abs(v / 256 - 8.94)).toBeLessThanOrEqual(0.4));
  add("Left+Down walks to -X and +Z", hold("GS_KEY_LEFT | GS_KEY_DOWN"), () => `${P(0)} < 0 && ${P(2)} > 0`, (v) => expect(v).toBe(1));
  add("holding B runs: Right for a second walks about 6 units", hold("GS_KEY_RIGHT | GS_KEY_B"), () => P(0), near(5.98, 0.05));
  add("B alone does not move the player", hold("GS_KEY_B"), () => `${P(0)} | ${P(2)}`, (v) => expect(v).toBe(0));
  add("the player does not move up or down", hold("GS_KEY_UP | GS_KEY_RIGHT | GS_KEY_B"), () => P(1), (v) => expect(v).toBe(0));

  // ---- Facing (0 = toward -Z, 90 = toward +X).
  const facing: [string, string, number][] = [
    ["UP", "UP", 0],
    ["UP | RIGHT", "Up+Right", 45],
    ["RIGHT", "Right", 90],
    ["DOWN | RIGHT", "Down+Right", 135],
    ["DOWN", "Down", 180],
    ["DOWN | LEFT", "Down+Left", -135],
    ["LEFT", "Left", -90],
    ["UP | LEFT", "Up+Left", -45]
  ];
  for (const [keys, label, angle] of facing) {
    const held = keys.split(" | ").map((k) => `GS_KEY_${k}`).join(" | ");
    add(`${label} turns the player to face ${angle} degrees`, hold(held, 3), () => R(), near(angle, 0.01));
  }
  add("releasing everything leaves it facing the way it last walked", () => `${hold("GS_KEY_RIGHT", 3)()} gs_keys_held = 0; gss0__process(0, ${DELTA}); gss0__process(0, ${DELTA});`, () => R(), near(90, 0.01));

  beforeAll(async () => {
    const player = createSceneNode({ name: "Player", kind: "MeshInstance3D", mesh: "cube" });
    const translated = translateScene3D(scriptedProject([{ name: "Move8", source: SOURCE, attachTo: ["Player"] }], [player]));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    expect(translated.diagnostics).toEqual([]);
    scene = translated.scene;
    const dump: DumpItem[] = items.map(({ setup, expr }) => ({ setup: setup(), expr: expr() }));
    values = (await runDump(scene, dump, work, "move-8way", 30)).values;
  }, 400_000);

  it("compiles with no diagnostics and the player as a moving node", () => {
    expect(scene.nodes.find((n) => n.name === "Player")!.dynamic).toBe(true);
  });

  items.forEach((item, i) => {
    it(item.name, () => item.check(values[i]));
  });
});
