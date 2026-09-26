import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCoinGameProject } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { translateProject3D } from "../translate-project";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * The example game (requirements/scene-designer/STORY.coin-collector-example.md) played on the DS's CPU with scripted button presses: the scripts really run, frame by frame, against the
 * real physics, and the answers are read back from the game's own state. What the picture looks like is not checked here (the labels and models have their own tests).
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

describe.skipIf(!toolchain.found)("the coin collector example on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-coin-game-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  // The game is translated up front (it is pure), so the cases below can look up node numbers while they are written.
  const translated = translateProject3D(createCoinGameProject());
  if (!translated.scenes) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const scene: DsScene3D = translated.scenes[0];
  let values: number[] = [];
  const index = (name: string): number => {
    const found = scene.nodes.findIndex((n) => n.name === name);
    if (found < 0) throw new Error(`no node ${name}`);
    return found;
  };
  const globalIndex = (name: string): number => scene.globals.findIndex((g) => g.name === name);
  const PLAYER = () => `gs_node_state[${index("Player")}]`;

  /** Starts the game afresh (nodes, script variables and globals), then plays `frames` frames with the buttons `held` down (a C expression) and `pressed` down on the first frame only. */
  const play = (frames: number, held = "0", pressed = "0", track = "", before = "", pressAt = 0): string => `
    gs_collision_reset(); /* what a scene change does: forget what the bodies last ran into */
    gs_init_nodes(); gs_scripts_reset();
    for (int g = 0; g < gs_global_count; g++) gs_global[g] = gs_global_initial[g];
    gs_update_nodes();
    ${before}
    for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].ready) gs_script_instances[i].ready(gs_script_instances[i].inst);
    int32_t peak = -0x7fffffff;
    for (int f = 0; f < ${frames}; f++) {
      gs_keys_held = ${held}; gs_keys_pressed = f == ${pressAt} ? (${pressed}) : 0;
      for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].process) gs_script_instances[i].process(gs_script_instances[i].inst, 68);
      gs_update_nodes();
      ${track}
    }`;
  const between = (low: number, high: number) => (v: number): void => {
    expect(v / 4096, `got ${v / 4096}`).toBeGreaterThanOrEqual(low);
    expect(v / 4096, `got ${v / 4096}`).toBeLessThanOrEqual(high);
  };
  interface Case {
    name: string;
    setup: () => string;
    expr: string;
    check: (v: number) => void;
  }
  const cases: Case[] = [];
  const add = (name: string, setup: () => string, expr: string, check: (v: number) => void): void => void cases.push({ name, setup, expr, check });
  const px = () => `${PLAYER()}.position[0]`;
  const py = () => `${PLAYER()}.position[1]`;
  const pz = () => `${PLAYER()}.position[2]`;

  add("starts falling and lands on the ground: resting on its top (half height 0.4)", () => play(90), py(), between(0.39, 0.46));
  add("stays put with no buttons held", () => play(90), px(), (v) => expect(Math.abs(v)).toBeLessThan(F(0.01)));
  add("walks right at 6 units a second: 30 frames is 3 units", () => play(30, "GS_KEY_RIGHT"), px(), between(2.9, 3.1));
  add("walks up (away from the camera): 30 frames is 3 units toward -z", () => play(30, "GS_KEY_UP"), pz(), between(-3.1, -2.9));
  add("is stopped by the east wall (its face at 11.5, half width 0.4)", () => play(400, "GS_KEY_RIGHT"), px(), between(11.0, 11.12));
  add("jumps when A is pressed on the ground: its highest point is well above its resting height", () => play(120, "0", "GS_KEY_A", `if (f > 40 && ${py()} > peak) peak = ${py()};`, "", 40), "peak", (v) => expect(v / 4096).toBeGreaterThan(1.5));
  add("and comes back down to the ground", () => play(120, "0", "0"), py(), between(0.39, 0.46));
  add("can't jump in mid air: pressing A once while falling from high up doesn't add height", () => play(20, "0", "GS_KEY_A", "", `${PLAYER()}.position[1] = ${F(8)};`, 5), py(), (v) => expect(v / 4096).toBeLessThan(8));
  add("is blocked by the crate (x 2..4, z 1..3): walking right along z = 2 stops at its side", () => play(120, "GS_KEY_RIGHT", "0", "", `${PLAYER()}.position[2] = ${F(2)}; ${PLAYER()}.position[0] = ${F(-2)};`), px(), between(1.5, 1.7));
  add("collects the first coin by walking to it, and the score goes up", () => play(160, "GS_KEY_LEFT | GS_KEY_UP"), `gs_global[${globalIndex("score")}]`, (v) => expect(v).toBeGreaterThanOrEqual(1));
  add("a collected coin disappears", () => play(160, "GS_KEY_LEFT | GS_KEY_UP"), `gs_node_state[${index("Coin1")}].visible`, (v) => expect(v).toBe(0));
  add("a coin that wasn't touched stays", () => play(160, "GS_KEY_LEFT | GS_KEY_UP"), `gs_node_state[${index("Coin2")}].visible`, (v) => expect(v).toBe(1));
  add("the coins spin (rotation about y changes)", () => play(30), `gs_node_state[${index("Coin2")}].rotation[1]`, (v) => expect(v).not.toBe(0));
  add(
    "touching all six coins wins: the score is 6 and the message shows",
    () =>
      play(
        1,
        "0",
        "0",
        "",
        ""
      ) +
      Array.from({ length: 6 }, (_, i) => `
        ${PLAYER()}.position[0] = gs_node_state[${index(`Coin${i + 1}`)}].position[0]; ${PLAYER()}.position[1] = ${F(0.8)}; ${PLAYER()}.position[2] = gs_node_state[${index(`Coin${i + 1}`)}].position[2];
        for (int f = 0; f < 4; f++) { for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].process) gs_script_instances[i].process(gs_script_instances[i].inst, 68); gs_update_nodes(); }`).join(""),
    `gs_global[${globalIndex("score")}] * 10 + gs_node_state[${index("Message")}].visible`,
    (v) => expect(v).toBe(61)
  );
  const enemy = (axis: number) => `gs_node_state[${index("Enemy")}].position[${axis}]`;
  add("the chaser walks toward the player: 60 frames of 2.5 units a second closes about 2.5 of the 11.3 between them", () => play(60), `gs_sqrt(gs_mulf(${enemy(0)} - ${px()}, ${enemy(0)} - ${px()}) + gs_mulf(${enemy(2)} - ${pz()}, ${enemy(2)} - ${pz()}))`, between(8.4, 9.3));
  add("the chaser stays on the ground while it walks", () => play(90), enemy(1), between(0.4, 0.9));
  add(
    "caught by the chaser, the player is sent back to the start (x 0) from where it stood (x 5)",
    () => play(4, "0", "0", "", `${PLAYER()}.position[0] = ${F(5)}; ${PLAYER()}.position[2] = ${F(5)}; ${enemy(0)} = ${F(5)}; ${enemy(2)} = ${F(5)}; ${enemy(1)} = ${F(1)};`),
    px(),
    (v) => expect(Math.abs(v)).toBeLessThan(F(0.6))
  );
  add("and the chaser goes back to the far wall (z about -10)", () => play(4, "0", "0", "", `${PLAYER()}.position[0] = ${F(5)}; ${PLAYER()}.position[2] = ${F(5)}; ${enemy(0)} = ${F(5)}; ${enemy(2)} = ${F(5)}; ${enemy(1)} = ${F(1)};`), enemy(2), between(-10.5, -9));
  add("the message stays hidden until then", () => play(30), `gs_node_state[${index("Message")}].visible`, (v) => expect(v).toBe(0));
  add("the camera follows the player (its x is the player's after walking right)", () => play(30, "GS_KEY_RIGHT"), `gs_node_state[${index("Camera")}].position[0] - ${px()}`, (v) => expect(Math.abs(v)).toBeLessThan(F(0.2)));

  beforeAll(async () => {
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup(), expr: c.expr }));
    values = (await runDump(scene, items, work, "coin-game", 40)).values;
  }, 400_000);

  cases.forEach((c, i) => {
    it(c.name, () => c.check(values[i]));
  });
});
