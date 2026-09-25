import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSceneNode, sampleTrack, type Animation, type AnimationKey, type AnimationProperty, type SceneNode } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * Animations on the real DS CPU (requirements/animation/TASK.compile-and-run-animations.md). The runtime's blend is compared with `sampleTrack` (core's animation.ts)
 * on random tracks at many times, and looping, stopping at the end, restarting, replacing, stopping, speed, autoplay, and "an animation wins over a script in the same
 * frame" are each checked. Each check calls the runtime directly: it plays an animation, steps it by a time, and reads the node's state back.
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);
const Q = (x: number): number => F(x) / 4096; // a number as the DS holds it

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mesh = (name: string): SceneNode => createSceneNode({ name, kind: "MeshInstance3D", mesh: "cube" });
const RAND_LENGTH = 5;

/** Random keys (3 to 7 of them, at distinct times inside the animation) with values from `value`. */
function randomKeys(rng: () => number, value: () => AnimationKey["value"]): AnimationKey[] {
  const count = 3 + Math.floor(rng() * 5);
  const times = new Set<number>();
  while (times.size < count) times.add(Math.round(rng() * RAND_LENGTH * 64) / 64);
  return [...times].sort((a, b) => a - b).map((time) => ({ time, value: value() }));
}

/** A straight animation from `from` to `to` on one node's position X over `length` seconds (the other components stay 0). */
const line = (id: string, node: SceneNode, axis: "x" | "y", to: number, length: number, loop = false, keys?: AnimationKey[]): Animation => ({
  id,
  name: id,
  length,
  loop,
  tracks: [
    {
      id: `${id}-t`,
      nodeId: node.id,
      property: "position",
      keys: keys ?? [{ time: 0, value: { x: 0, y: 0, z: 0 } }, { time: length, value: { x: axis === "x" ? to : 0, y: axis === "y" ? to : 0, z: 0 } }]
    }
  ]
});

interface RandomTracks {
  animation: Animation;
  /** The tracks with everything rounded to the DS's 20.12, for the oracle. */
  quantized: Array<{ property: AnimationProperty; keys: AnimationKey[] }>;
}

describe.skipIf(!toolchain.found)("animations on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-animation-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let scene: DsScene3D;
  let values: number[] = [];
  const index = (name: string): number => scene.nodes.findIndex((n) => n.name === name);
  const P = (): number => scene.nodes[index("Anim")].animPlayer;
  const AUTO = (): number => scene.nodes[index("Auto")].animPlayer;
  const S = (name: string, component: number): string => `gs_node_state[${index(name)}].position[${component}]`;

  // ---- The scene: nodes to animate, a player with several animations, and one that autoplays.
  const rng = mulberry32(2024);
  const nodes = { pos: mesh("Pos"), rot: mesh("Rot"), scl: mesh("Scl"), vis: mesh("Vis"), mover: mesh("Mover"), solo: mesh("Solo"), solo2: mesh("Solo2"), ctl: mesh("Ctl") };
  const vec = (lo: number, hi: number) => (): AnimationKey["value"] => ({ x: lo + rng() * (hi - lo), y: lo + rng() * (hi - lo), z: lo + rng() * (hi - lo) });
  const random: RandomTracks = (() => {
    const tracks = [
      { id: "rp", nodeId: nodes.pos.id, property: "position" as const, keys: randomKeys(rng, vec(-20, 20)) },
      { id: "rr", nodeId: nodes.rot.id, property: "rotation" as const, keys: randomKeys(rng, vec(-360, 360)) },
      { id: "rs", nodeId: nodes.scl.id, property: "scale" as const, keys: randomKeys(rng, vec(0.2, 3)) },
      { id: "rv", nodeId: nodes.vis.id, property: "visible" as const, keys: randomKeys(rng, () => rng() < 0.5) }
    ];
    const quantize = (v: AnimationKey["value"]): AnimationKey["value"] => (typeof v === "object" ? { x: Q(v.x), y: Q(v.y), z: Q(v.z) } : v);
    return {
      animation: { id: "rand", name: "rand", length: RAND_LENGTH, loop: false, tracks },
      quantized: tracks.map((t) => ({ property: t.property, keys: t.keys.map((k) => ({ time: Q(k.time), value: quantize(k.value) })) }))
    };
  })();
  const animations: Animation[] = [
    random.animation, //                                                                       0
    line("line", nodes.solo, "x", 10, 2), //                                                    1: x 0 -> 10 in 2 s
    line("loop", nodes.solo, "x", 0, 2, true, [{ time: 0, value: { x: 0, y: 0, z: 0 } }, { time: 1, value: { x: 4, y: 0, z: 0 } }, { time: 2, value: { x: 0, y: 0, z: 0 } }]), // 2
    line("other", nodes.solo, "y", 6, 1), //                                                    3: y 0 -> 6 in 1 s
    line("wins", nodes.mover, "x", 10, 2) //                                                    4
  ];
  const players = (): SceneNode[] => {
    const anim = createSceneNode({ name: "Anim", kind: "AnimationPlayer" });
    anim.animation = { animations };
    const auto = createSceneNode({ name: "Auto", kind: "AnimationPlayer" });
    auto.animation = { animations: [line("auto", nodes.solo2, "x", 8, 1)], autoplay: "auto" };
    return [anim, auto];
  };
  const SCRIPT = "func _process(delta):\n    position.x = 5.0\n";
  /** A script that starts, stops and speeds up the "line" animation from the buttons. */
  const CONTROL = `func _process(delta):
    if Input.is_button_pressed("a"):
        $Anim.play("line")
    if Input.is_button_pressed("b"):
        $Anim.stop()
    if Input.is_button_pressed("x"):
        $Anim.speed_scale = 2.0
    if $Anim.is_playing():
        position.y = 1.0
    else:
        position.y = 0.0
`;
  const press = (mask: string): string => `gs_keys_pressed = ${mask}; gs_keys_held = 0; gs_keys_released = 0; gss1__process(0, 68); gs_keys_pressed = 0;`;

  interface Case {
    name: string;
    setup: () => string;
    expr: () => string;
    check: (value: number) => void;
  }
  const cases: Case[] = [];
  const add = (name: string, setup: () => string, expr: () => string, check: (value: number) => void): void => void cases.push({ name, setup, expr, check });
  const near = (expected: number, tolerance = 3) => (v: number): void => expect(Math.abs(v - expected), `got ${v}, wanted ${expected} (+-${tolerance})`).toBeLessThanOrEqual(tolerance);
  const exactly = (expected: number) => (v: number): void => expect(v).toBe(expected);
  const play = (animation: number): string => `gs_anim_play(${P()}, ${animation});`;
  const step = (seconds: number): string => `gs_update_animation(${F(seconds)});`;

  // ---- Accuracy: the runtime's blend against core's sampling, on random tracks at many times.
  const times: number[] = [];
  for (let i = 0; i < 160; i++) times.push(rng() * (RAND_LENGTH + 0.4));
  for (const track of random.quantized) for (const key of track.keys) times.push(key.time, Math.max(0, key.time - 1 / 4096 * 3), key.time + 3 / 4096);
  const sampleAt = (t: number): number[] => {
    const at = Math.min(Q(t), RAND_LENGTH);
    const out: number[] = [];
    for (const track of random.quantized) {
      const value = sampleTrack(track, at)!;
      if (typeof value === "object") out.push(F(value.x), F(value.y), F(value.z));
      else out.push(value ? 1 : 0);
    }
    return out; // position xyz, rotation xyz, scale xyz, visible
  };
  const table = (): string =>
    `static const int32_t rows[${times.length}][11] = {\n${times.map((t) => `{ ${F(t)}, ${sampleAt(t).join(", ")} }`).join(",\n")}\n};`;
  const compare = (): string => `
    ${table()}
    int32_t maxError = 0, visibleWrong = 0;
    for (int k = 0; k < ${times.length}; k++) {
      ${play(0)}
      gs_update_animation(rows[k][0]);
      const int32_t *want = rows[k] + 1;
      for (int c = 0; c < 3; c++) {
        int32_t e1 = ${S("Pos", 0).replace("[0]", "[c]")} - want[c]; if (e1 < 0) e1 = -e1; if (e1 > maxError) maxError = e1;
        int32_t e2 = gs_node_state[${index("Rot")}].rotation[c] - want[3 + c]; if (e2 < 0) e2 = -e2; if (e2 > maxError) maxError = e2;
        int32_t e3 = gs_node_state[${index("Scl")}].scale[c] - want[6 + c]; if (e3 < 0) e3 = -e3; if (e3 > maxError) maxError = e3;
      }
      if (gs_node_state[${index("Vis")}].visible != want[9]) visibleWrong++;
    }`;
  add(`random tracks (position, rotation, scale) at ${times.length} times agree with core's sampling to within 2 fixed-point steps`, compare, () => "maxError", (v) => expect(v).toBeLessThanOrEqual(2));
  add("and a random visibility track is stepped exactly like core's sampling, at every one of them", compare, () => "visibleWrong", exactly(0));

  // ---- Playing.
  add("a straight animation is halfway a quarter of the way in: x at 0.5 s of 0 -> 10 over 2 s is 2.5", () => `${play(1)} ${step(0.5)}`, () => S("Solo", 0), near(F(2.5)));
  add("it is playing while it runs", () => `${play(1)} ${step(0.5)}`, () => `gs_anim_is_playing(${P()})`, exactly(1));
  add("a non-looping animation stops on its last frame: after 3 s x is 10 and it is no longer playing", () => `${play(1)} ${step(3)}`, () => S("Solo", 0), near(F(10)));
  add("and is_playing is false then", () => `${play(1)} ${step(3)}`, () => `gs_anim_is_playing(${P()})`, exactly(0));
  add("stepping a non-looping animation more doesn't move it again", () => `${play(1)} ${step(3)} ${S("Solo", 0)} = ${F(1)}; ${step(1)}`, () => S("Solo", 0), exactly(F(1)));
  add("a looping animation wraps: after 2.5 s of a 2 s loop it is 0.5 s in (x = 2)", () => `${play(2)} ${step(2.5)}`, () => S("Solo", 0), near(F(2)));
  add("and is still playing", () => `${play(2)} ${step(2.5)}`, () => `gs_anim_is_playing(${P()})`, exactly(1));
  add("after 4.25 s it is 0.25 s into the third round (x = 1)", () => `${play(2)} ${step(4.25)}`, () => S("Solo", 0), near(F(1)));
  add("many small steps add up: 30 frames of 1/60 s is a 0.498 s into a 0 -> 10 over 2 s animation (2.49)", () => `${play(1)} for (int f = 0; f < 30; f++) gs_update_animation(68);`, () => S("Solo", 0), near(Math.round((5 * 2040) / 4096 * 4096), 4));
  add("play restarts from the beginning: 0.5 s in, play again, 0.25 s more is x = 1.25", () => `${play(1)} ${step(0.5)} ${play(1)} ${step(0.25)}`, () => S("Solo", 0), near(F(1.25)));
  add("stop freezes it where it is, however long is stepped after", () => `${play(1)} ${step(0.5)} gs_anim_stop(${P()}); ${step(1)}`, () => S("Solo", 0), near(F(2.5)));
  add("and is_playing is false after stop", () => `${play(1)} ${step(0.5)} gs_anim_stop(${P()});`, () => `gs_anim_is_playing(${P()})`, exactly(0));
  add("a second animation replaces the first: its position track sets the whole position (Y follows it: 3 after 0.5 s of 0 -> 6 over 1 s)", () => `${play(1)} ${step(0.5)} ${play(3)} ${step(0.5)}`, () => S("Solo", 1), near(F(3)));
  add("and X, which the second animation sets to its own 0, is no longer the first's 2.5", () => `${play(1)} ${step(0.5)} ${play(3)} ${step(0.5)}`, () => S("Solo", 0), exactly(0));
  add("at speed 2 it goes twice as fast: 0.5 s is 1 s of animation (x = 5)", () => `gs_anim_set_speed(${P()}, ${F(2)}); ${play(1)} ${step(0.5)}`, () => S("Solo", 0), near(F(5)));
  add("at speed 0.5, half as fast (x = 1.25 after 0.5 s)", () => `gs_anim_set_speed(${P()}, ${F(0.5)}); ${play(1)} ${step(0.5)}`, () => S("Solo", 0), near(F(1.25)));
  add("the speed can be read back, starts at 1, and is kept between 0.05 and 10", () => `gs_anim_set_speed(${P()}, ${F(1)}); int32_t start = gs_anim_get_speed(${P()}); gs_anim_set_speed(${P()}, ${F(100)}); int32_t high = gs_anim_get_speed(${P()}); gs_anim_set_speed(${P()}, 0); int32_t low = gs_anim_get_speed(${P()}); gs_anim_set_speed(${P()}, ${F(1)});`, () => "(start == 4096) * 1 + (high == 40960) * 2 + (low == 205) * 4", exactly(7));
  add("play with an animation that doesn't exist does nothing (and a node with no player doesn't crash)", () => `${play(1)} ${step(0.5)} gs_anim_play(${P()}, 99); gs_anim_play(-1, 0); gs_anim_stop(-1); gs_anim_set_speed(-1, 0); ${step(0.5)}`, () => S("Solo", 0), near(F(5)));

  // ---- A script controls the player.
  add("a script's play(name) starts the animation: A pressed, then 0.5 s, x = 2.5", () => `${press("GS_KEY_A")} ${step(0.5)}`, () => S("Solo", 0), near(F(2.5)));
  add("and before it is pressed nothing plays", () => `${S("Solo", 0)} = 0; ${press("0")} ${step(0.5)}`, () => `${S("Solo", 0)} + gs_anim_is_playing(${P()})`, exactly(0));
  add("is_playing() in the script sees it: the script sets its own y to 1 while the animation plays", () => `${press("GS_KEY_A")} ${press("0")}`, () => S("Ctl", 1), exactly(F(1)));
  add("and stop() from a script stops it, and the script sees that too", () => `${press("GS_KEY_A")} ${step(0.5)} ${press("GS_KEY_B")} ${step(1)} ${press("0")}`, () => `${S("Solo", 0)} * 10 + ${S("Ctl", 1)}`, near(F(2.5) * 10, 3));
  add("speed_scale set from a script takes effect: X pressed, then A, then 0.5 s is 1 s in (x = 5)", () => `${press("GS_KEY_X")} ${press("GS_KEY_A")} ${step(0.5)}`, () => S("Solo", 0), near(F(5)));
  add("and reads back as 2", () => `${press("GS_KEY_X")}`, () => `gs_anim_get_speed(${P()})`, exactly(F(2)));

  // ---- Autoplay and scripts.
  add("an autoplay animation is playing from the start: after init and 0.5 s of a 0 -> 8 over 1 s, x = 4", () => `gs_init_animation(); ${step(0.5)}`, () => S("Solo2", 0), near(F(4)));
  add("and its player reports playing right after init, while the other player is not", () => "gs_init_animation();", () => `gs_anim_is_playing(${AUTO()}) * 10 + gs_anim_is_playing(${P()})`, exactly(10));
  add("an animation wins over a script in the same frame: the script sets x = 5, the animation (x = 2.5 at 0.5 s) has the last word", () => `${play(4)} gss0__process(0, 68); ${step(0.5)}`, () => S("Mover", 0), near(F(2.5)));
  add("and once the animation has finished the script has it again", () => `${play(4)} ${step(3)} gss0__process(0, 68);`, () => S("Mover", 0), exactly(F(5)));

  beforeAll(async () => {
    const translated = translateScene3D(scriptedProject([{ name: "Mover", source: SCRIPT, attachTo: ["Mover"] }, { name: "Control", source: CONTROL, attachTo: ["Ctl"] }], [...Object.values(nodes), ...players()]));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    scene = translated.scene;
    const items: DumpItem[] = cases.map((c) => ({ setup: `gs_init_animation(); ${c.setup()}`, expr: c.expr() }));
    values = (await runDump(scene, items, work, "animation", 40)).values;
  }, 400_000);

  it("compiled the animations for every node they animate, with the script's node and the animated ones movable", () => {
    expect(scene.animationPlayers).toHaveLength(2);
    const dynamic = (name: string) => scene.nodes[index(name)].dynamic;
    expect(["Pos", "Rot", "Scl", "Mover", "Solo", "Solo2", "Vis", "Ctl"].map(dynamic)).toEqual([true, true, true, true, true, true, false, true]);
  });

  cases.forEach((c, i) => {
    it(c.name, () => c.check(values[i]));
  });
});
