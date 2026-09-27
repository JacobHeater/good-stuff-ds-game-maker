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
 * tests/prototypes/scripts/flight-8way.gsscript on the DS's CPU with scripted button presses: taking off with one tap of B and landing with two, flying relative to the camera,
 * and a camera (a child of the player) that ends up behind the player and looking at it, turning as L and R orbit it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const readScript = (name: string): string => readFileSync(resolve(HERE, "..", "..", "..", "..", "tests", "prototypes", "scripts", name), "utf-8");
/** The script for a body with a collision shape, and the one for a bare Node3D (it stands on a flat ground at y = 0 instead of a floor shape). */
const variants = [
  { label: "with a collision shape", file: "flight-8way.gsscript", kind: "MeshInstance3D" as const, shapes: true, rest: 0.6 },
  { label: "on a bare Node3D", file: "flight-8way-free.gsscript", kind: "Node3D" as const, shapes: false, rest: 0 }
];
const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

for (const variant of variants) describe.skipIf(!toolchain.found)(`the 8-way flight script on the DS, ${variant.label}`, () => {
  const source = readScript(variant.file);
  const work = mkdtempSync(join(tmpdir(), "gsds-flight-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const shape = (name: string, size: [number, number, number], position: [number, number, number]): SceneNode => {
    const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position: { x: position[0], y: position[1], z: position[2] } } });
    node.collision = { shape: "box", size: { x: size[0], y: size[1], z: size[2] }, solid: true };
    return node;
  };
  const player = createSceneNode({
    name: "Player",
    kind: variant.kind,
    ...(variant.kind === "MeshInstance3D" ? { mesh: "cube" as const } : {}),
    transform3D: { position: { x: 0, y: variant.rest, z: 0 } },
    children: [...(variant.shapes ? [shape("PlayerShape", [1, 1, 1], [0, 0, 0])] : []), createSceneNode({ name: "Camera3D", kind: "Camera3D" })]
  });
  const translated = translateScene3D(scriptedProject([{ name: "Flight", source, attachTo: ["Player"] }], [player, ...(variant.shapes ? [shape("Floor", [60, 1, 60], [0, -0.5, 0])] : [])]));
  if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const scene: DsScene3D = translated.scene;
  expect(translated.diagnostics.filter((d) => d.severity === "error" || d.code === "script-warning")).toEqual([]);
  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);
  const P = (axis: number) => `gs_node_state[${index("Player")}].position[${axis}]`;
  const CAM = (element: number) => `gs_world_matrix[${index("Camera3D")}].m[${element}]`;
  const PW = (element: number) => `gs_world_matrix[${index("Player")}].m[${element}]`;
  const between = (low: number, high: number) => (v: number): void => {
    expect(v / 4096, `got ${v / 4096}`).toBeGreaterThanOrEqual(low);
    expect(v / 4096, `got ${v / 4096}`).toBeLessThanOrEqual(high);
  };

  /**
   * Starts afresh, then plays `frames` frames: \`held\` and \`pressed\` are C expressions of the frame number f. \`before\` runs after the scene is set up (place the player, set the camera angle).
   */
  const play = (frames: number, held: string, pressed = "0", before = ""): string => `
    gs_collision_reset(); gs_init_nodes(); gs_scripts_reset(); gs_update_nodes();
    ${before}
    for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].ready) gs_script_instances[i].ready(gs_script_instances[i].inst);
    for (int f = 0; f < ${frames}; f++) {
      gs_keys_held = ${held}; gs_keys_pressed = ${pressed};
      for (int i = 0; i < gs_script_instance_count; i++) if (gs_script_instances[i].process) gs_script_instances[i].process(gs_script_instances[i].inst, 68);
      gs_update_nodes();
    }`;

  const cases: Array<{ name: string; setup: string; expr: string; check: (v: number) => void }> = [];
  const add = (name: string, setup: string, expr: string, check: (v: number) => void): void => void cases.push({ name, setup, expr, check });

  add("on the ground with no buttons it stays where it is", play(60, "0"), P(1), between(variant.rest - 0.2, variant.rest + 0.1));
  add("holding X lifts it off the ground and it stays up, flying: 30 frames of X is about 1.5 units higher", play(30, "GS_KEY_X"), P(1), (v) => expect(v / 4096).toBeGreaterThan(variant.rest + 0.8));
  add("walking on the ground: the D-pad moves it without X (RIGHT for 30 frames goes toward -X, about 1.5 units or more)", play(30, "GS_KEY_RIGHT"), P(0), (v) => expect(v / 4096).toBeLessThan(-1.2));
  add("and it stays on the ground while it walks", play(30, "GS_KEY_RIGHT"), P(1), between(variant.rest - 0.2, variant.rest + 0.15));
  add("walking is slower than flying: 60 frames of RIGHT on the ground goes less than 4.2 units", play(60, "GS_KEY_RIGHT"), P(0), (v) => expect(v / 4096).toBeGreaterThan(-4.2));
  add("it turns to face its walk: after walking toward -X its heading is 90 degrees", play(30, "GS_KEY_RIGHT"), `gs_node_state[${index("Player")}].rotation[1]`, between(88, 92));
  add("flying, UP goes forward (+Z) from the start heading: 60 frames after taking off it has gone well over 3 units", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_UP : 0)"), P(2), (v) => expect(v / 4096).toBeGreaterThan(3));
  add("and stays in line (x about 0)", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_UP : 0)"), P(0), between(-0.3, 0.3));
  add("with the camera looking toward +Z, RIGHT goes to the right of the view: toward -X", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_RIGHT : 0)"), P(0), (v) => expect(v / 4096).toBeLessThan(-3));
  add("LEFT goes toward +X", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_LEFT : 0)"), P(0), (v) => expect(v / 4096).toBeGreaterThan(3));
  add("with the camera turned a quarter (looking toward +X), UP goes toward +X", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_UP : 0)", `gs_node_state[${index("Player")}].rotation[1] = ${F(90)};`), P(0), (v) => expect(v / 4096).toBeGreaterThan(3));
  add("and not sideways (z about 0)", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_UP : 0)", `gs_node_state[${index("Player")}].rotation[1] = ${F(90)};`), P(2), between(-0.5, 0.5));
  add("a diagonal isn't faster than straight: UP + RIGHT covers about the same ground as UP alone (within 15%)", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? (GS_KEY_UP | GS_KEY_RIGHT) : 0)"), `gs_sqrt(gs_mulf(${P(0)}, ${P(0)}) + gs_mulf(${P(2)}, ${P(2)}))`, (v) => {
    const straight = 7 * (120 - 30) / 60; // the top speed for those frames, an upper bound
    expect(v / 4096).toBeLessThan(straight * 1.15);
    expect(v / 4096).toBeGreaterThan(3);
  });
  add("holding B while flying brings it down to the ground: from 8 units up (after a moment of X) 150 frames of B lands it", play(150, "f < 5 ? GS_KEY_X : GS_KEY_B", "0", `${P(1)} = ${F(8)};`), P(1), between(variant.rest - 0.2, variant.rest + 0.3));
  add("with neither X nor B held it hangs in the air (from 8 units up: still there 60 frames after leaving X)", play(90, "f < 5 ? GS_KEY_X : 0", "0", `${P(1)} = ${F(8)};`), P(1), (v) => expect(v / 4096).toBeGreaterThan(8));
  add("and lands and walks again afterwards: after landing, RIGHT walks it (it doesn't fly off)", play(260, "f < 5 ? GS_KEY_X : (f < 200 ? GS_KEY_B : GS_KEY_RIGHT)", "0", `${P(1)} = ${F(8)};`), P(1), between(variant.rest - 0.2, variant.rest + 0.3));
  add("flying, it turns to face the way it goes: after flying toward -X its heading is 90 degrees (the script turns it by model_front_yaw = 180 for a model that faces -Z)", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_RIGHT : 0)"), `gs_node_state[${index("Player")}].rotation[1]`, between(88, 92));
  add("the camera sits 3.5 behind the player and 1.2 above (looking toward +Z: z is 3.5 less)", play(2, "0"), `${CAM(14)} - ${PW(14)}`, between(-3.55, -3.45));
  add("and 1.2 above", play(2, "0"), `${CAM(13)} - ${PW(13)}`, between(1.15, 1.25));
  add("and looks toward +Z (its own Z axis points to -Z in the world)", play(2, "0"), CAM(10), between(-1.01, -0.99));
  add("holding R orbits the camera a quarter turn in a second: it is then at -X of the player, looking toward +X", play(60, "GS_KEY_R"), `${CAM(12)} - ${PW(12)}`, between(-3.6, -3.3));
  add("and its Z axis points to -X in the world (it looks toward +X)", play(60, "GS_KEY_R"), CAM(8), between(-1.01, -0.95));
  add("holding L orbits the other way: the camera ends up at +X, looking toward -X", play(60, "GS_KEY_L"), `${CAM(12)} - ${PW(12)}`, between(3.3, 3.6));
  add("the camera keeps looking at the player while the player turns to face its flight (the camera's heading doesn't follow the player's)", play(120, "(f < 20 ? GS_KEY_X : 0) | (f > 30 ? GS_KEY_RIGHT : 0)"), CAM(10), between(-1.01, -0.99));

  let values: number[] = [];
  beforeAll(async () => {
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup, expr: c.expr }));
    values = (await runDump(scene, items, work, `flight-8way-${variant.shapes ? "body" : "free"}`, 40)).values;
  }, 400_000);
  cases.forEach((c, i) => it(c.name, () => c.check(values[i])));
});
