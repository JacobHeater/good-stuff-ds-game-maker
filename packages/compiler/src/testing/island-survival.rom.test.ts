import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIslandSurvivalProject } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { translateProject3D } from "../translate-project";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * The island survival example (requirements/scene-designer/STORY.island-survival-example.md) played on the DS's CPU with scripted
 * button presses, the same `runDump` harness `coin-game.rom.test.ts` already uses. Movement/jumping/overlaps/labels/save/change_scene
 * are already hardware-proven by the coin game and by each feature's own dedicated ROM test (sky-box-cycle, tile-map-3d,
 * inventory(-ui-panel), spawn-pools); this test is scoped to the genuinely new thing -- several of those features wired together in
 * one real game (chopping a tree into the Inventory, spending it on a spawn-pooled campfire, a crab that uses ray_cast to avoid
 * wandering off the island, falling off costing a life and eventually saving the best day reached).
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

describe.skipIf(!toolchain.found)("the island survival example on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-island-survival-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const translated = translateProject3D(createIslandSurvivalProject());
  if (!translated.scenes) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const scene: DsScene3D = translated.scenes[0]; // "Island" -- the start scene, listed first (the campfire template is scenes[1], never played directly)
  let values: number[] = [];

  const index = (name: string): number => {
    const found = scene.nodes.findIndex((n) => n.name === name);
    if (found < 0) throw new Error(`no node ${name}`);
    return found;
  };
  const globalIndex = (name: string): number => scene.globals.findIndex((g) => g.name === name);
  const pool = scene.spawnPools[0];
  const fireVisible = (slot: number) => `gs_node_state[${pool.nodeStart} + ${slot} * ${pool.nodesPerCopy}].visible`;
  const WOOD = 0; // project.items order: wood, coconut
  const COCONUT = 1;
  const wood = () => `gs_inventory_count(0, ${WOOD})`;
  const coconut = () => `gs_inventory_count(0, ${COCONUT})`;
  const PLAYER = () => `gs_node_state[${index("Player")}]`;
  const px = () => `${PLAYER()}.position[0]`;
  const py = () => `${PLAYER()}.position[1]`;
  const pz = () => `${PLAYER()}.position[2]`;

  /** Every dump item starts from exactly this clean state -- every reset the real game's own `enter_scene` does, not just the ones `coin-game.rom.test.ts` happened to need (it never touched Inventory or spawn pools). */
  const RESET = `
    gs_collision_reset();
    gs_init_nodes(); gs_scripts_reset(); gs_init_inventory(); gs_init_spawn_pools();
    for (int g = 0; g < gs_global_count; g++) gs_global[g] = gs_global_initial[g];
    gs_update_nodes();`;
  const READY = `for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].ready) gs_script_instances[i].ready(gs_script_instances[i].inst);`;
  const STEP = `for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].process) gs_script_instances[i].process(gs_script_instances[i].inst, 68); gs_update_nodes();`;

  /** Starts the game afresh, then plays `frames` frames with `held` down the whole time and `pressed` down only on frame `pressAt`. */
  const play = (frames: number, held = "0", pressed = "0", before = "", pressAt = 0): string => `
    ${RESET}
    ${before}
    ${READY}
    for (int f = 0; f < ${frames}; f++) {
      gs_keys_held = ${held}; gs_keys_pressed = f == ${pressAt} ? (${pressed}) : 0;
      ${STEP}
    }`;
  const atTree1 = `${px()} = gs_node_state[${index("Tree1")}].position[0]; ${py()} = ${F(0.8)}; ${pz()} = gs_node_state[${index("Tree1")}].position[2];`;
  const atCoconut1 = `${px()} = gs_node_state[${index("Coconut1")}].position[0]; ${py()} = ${F(0.8)}; ${pz()} = gs_node_state[${index("Coconut1")}].position[2];`;
  const give = (item: number, n: number) => `gs_inventory_add(0, ${item}, ${n});`;

  interface Case {
    name: string;
    setup: () => string;
    expr: string;
    check: (v: number) => void;
  }
  const cases: Case[] = [];
  const add = (name: string, setup: () => string, expr: string, check: (v: number) => void): void => void cases.push({ name, setup, expr, check });

  add("chopping a tree by walking into it gives 2 Wood", () => play(4, "0", "0", atTree1), wood(), (v) => expect(v).toBe(2));
  add("a chopped tree disappears", () => play(4, "0", "0", atTree1), `gs_node_state[${index("Tree1")}].visible`, (v) => expect(v).toBe(0));
  add("picking up a coconut gives 1 Coconut", () => play(4, "0", "0", atCoconut1), coconut(), (v) => expect(v).toBe(1));
  add("a picked-up coconut disappears", () => play(4, "0", "0", atCoconut1), `gs_node_state[${index("Coconut1")}].visible`, (v) => expect(v).toBe(0));

  add(
    // (1, 1, 0): well clear of every tree/coconut (all >= 2.2 units away) so none of them accidentally chop/pick up and refill Wood behind this test's own back.
    "pressing B with 2+ Wood spends 2 and lights the first campfire slot, at the player's own position",
    () => play(2, "0", "GS_KEY_B", `${give(WOOD, 2)} ${px()} = ${F(1)}; ${py()} = ${F(1)}; ${pz()} = ${F(0)};`),
    `${wood()} * 1000 + ${fireVisible(0)} * 100 + (gs_node_state[${pool.nodeStart}].position[0] == ${F(1)})`,
    (v) => expect(v).toBe(101)
  );
  add(
    "pressing B with less than 2 Wood spends nothing and lights nothing",
    () => play(2, "0", "GS_KEY_B", give(WOOD, 1)),
    `${wood()} * 10 + ${fireVisible(0)}`,
    (v) => expect(v).toBe(10)
  );
  add(
    "placing all 3 campfires fills every slot; a 4th attempt (even with enough Wood left) lights nothing new and spends nothing more",
    () => `
    ${RESET}
    ${READY}
    for (int attempt = 0; attempt < 4; attempt++) {
      ${give(WOOD, 8)}
      gs_keys_held = 0; gs_keys_pressed = GS_KEY_B;
      ${STEP}
      gs_keys_pressed = 0;
      for (int f = 0; f < 2; f++) { ${STEP} }
    }`,
    `(${fireVisible(0)} + ${fireVisible(1)} + ${fireVisible(2)}) * 1000 + ${wood()}`,
    (v) => expect(v).toBe(3 * 1000 + (8 * 4 - 2 * 3))
  );
  add(
    "pressing X despawns the last campfire placed and frees its slot",
    () => `
    ${RESET}
    ${give(WOOD, 2)}
    ${READY}
    gs_keys_held = 0; gs_keys_pressed = GS_KEY_B;
    ${STEP}
    gs_keys_pressed = 0;
    for (int f = 0; f < 2; f++) { ${STEP} }
    gs_keys_pressed = GS_KEY_X;
    ${STEP}`,
    `${fireVisible(0)} * 10 + (gs_global[${globalIndex("lastFire")}] == -1)`,
    (v) => expect(v).toBe(1)
  );

  add(
    "the crab, left to wander on its own, never ends up off the island (ray_cast kept turning it away from the edge)",
    () => play(300),
    `gs_node_state[${index("Crab")}].position[1]`,
    (v) => expect(v / 4096).toBeGreaterThan(-0.5)
  );
  add(
    // Crab's own _process moves it (even away from the player, if its first move happens to resolve starting
    // exactly inside the player's own solid shape) before checking the overlap -- so a single teleport-then-step
    // isn't reliable. Forcing the crab back onto the player at the start of every frame guarantees the overlap
    // check (which runs after that frame's own move) sees them together at least once.
    "the crab steals a Wood if it catches the player",
    () => `
      ${RESET}
      ${give(WOOD, 3)}
      ${READY}
      for (int f = 0; f < 5; f++) {
        gs_node_state[${index("Crab")}].position[0] = ${px()};
        gs_node_state[${index("Crab")}].position[1] = ${py()};
        gs_node_state[${index("Crab")}].position[2] = ${pz()};
        ${STEP}
      }`,
    wood(),
    (v) => expect(v).toBeLessThan(3)
  );

  add(
    "falling off the island (below the ocean) costs a life and resets the player back to the start",
    () => play(2, "0", "0", `${py()} = ${F(-5)};`),
    `gs_global[${globalIndex("lives")}] * 1000 + ${px()}`,
    (v) => expect(v).toBe(2000)
  );
  add(
    "losing the last life shows the message and saves the best day reached",
    () => play(2, "0", "0", `gs_global[${globalIndex("lives")}] = 1; gs_global[${globalIndex("day")}] = 4; ${py()} = ${F(-5)};`),
    `gs_node_state[${index("Message")}].visible * 100 + gs_global[${globalIndex("bestDay")}]`,
    (v) => expect(v).toBe(104)
  );

  add(
    "night falls after 10 simulated seconds (the day sky hides, the night sky shows)",
    () => play(610),
    `gs_node_state[${index("SkyDay")}].visible * 10 + gs_node_state[${index("SkyNight")}].visible`,
    (v) => expect(v).toBe(1)
  );

  beforeAll(async () => {
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup(), expr: c.expr }));
    values = (await runDump(scene, items, work, "island-survival", 40)).values;
  }, 400_000);

  cases.forEach((c, i) => {
    it(c.name, () => c.check(values[i]));
  });
});
