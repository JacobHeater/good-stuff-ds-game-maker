import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { randomCases, WORKED_CASES, type Pair } from "./collision-cases";
import { SHAPE_CODE, type PlacedShape, type ShapeKind } from "./collision-oracle";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * Collision on the real DS CPU (requirements/collision/TASK.compile-and-run-collision-checks.md). The runtime's `gs_shapes_overlap` (GJK in
 * 20.12 fixed point) is given pairs of placed shapes and its answers, drawn on the screen and read back from an emulator capture, are compared with
 * (1) answers worked out by hand and (2) the independent oracle (collision-oracle.ts, a different method in double precision) on seeded random pairs
 * of every combination of box, sphere, capsule and cylinder, at random rotations and uneven scales, at least 3 % from touching.
 */

const toolchain = await new NodeToolchainLocator().locate();

const KINDS: ShapeKind[] = ["box", "sphere", "capsule", "cylinder"];
/** Random cases per shape pair (16 pairs) for each size of shape; GSDS_COLLISION_STRESS=<n> multiplies them (and changes the seeds) for a heavier run. */
const STRESS = Number(process.env.GSDS_COLLISION_STRESS ?? 1) || 1;
const SIZES = [
  { label: "ordinary", factor: 1, perPair: 24 * STRESS },
  { label: "large (6 x)", factor: 6, perPair: 8 * STRESS },
  { label: "small (0.3 x)", factor: 0.3, perPair: 8 * STRESS }
];
const PER_ITEM = 30; // an item's answer is one bit per case, in one 32-bit number

/** A shape as the 19 integers `GsShapeInst` is filled from. */
const row = (s: PlacedShape): number[] => [SHAPE_CODE[s.shape], ...s.p, ...s.rotation.flat(), ...s.scale, ...s.center];

/** One dump item: runs up to 30 pairs through the runtime and answers with a bit per pair (1 = overlap). */
function itemFor(pairs: readonly Pair[]): DumpItem {
  const rows = pairs.map((p) => `{ ${[...row(p.a), ...row(p.b)].join(", ")} }`).join(",\n");
  return {
    setup: `
      static const int32_t rows[${pairs.length}][38] = {\n${rows}\n};
      int32_t bits = 0;
      for (int k = 0; k < ${pairs.length}; k++) {
        GsShapeInst first, second;
        const int32_t *r = rows[k];
        first.shape = r[0]; second.shape = r[19];
        for (int i = 0; i < 3; i++) {
          first.p[i] = r[1 + i]; second.p[i] = r[20 + i];
          first.scale[i] = r[13 + i]; second.scale[i] = r[32 + i];
          first.center[i] = r[16 + i]; second.center[i] = r[35 + i];
          for (int j = 0; j < 3; j++) { first.rotation[i][j] = r[4 + i * 3 + j]; second.rotation[i][j] = r[23 + i * 3 + j]; }
        }
        if (gs_shapes_overlap(&first, &second)) bits |= (int32_t)(1u << k);
      }`,
    expr: "bits"
  };
}

/** The C that fills `first` and `second` from row `r` of a table of pairs (see `row`). */
const FILL = `
        GsShapeInst first, second;
        first.shape = r[0]; second.shape = r[19];
        for (int i = 0; i < 3; i++) {
          first.p[i] = r[1 + i]; second.p[i] = r[20 + i];
          first.scale[i] = r[13 + i]; second.scale[i] = r[32 + i];
          first.center[i] = r[16 + i]; second.center[i] = r[35 + i];
          for (int j = 0; j < 3; j++) { first.rotation[i][j] = r[4 + i * 3 + j]; second.rotation[i][j] = r[23 + i * 3 + j]; }
        }`;

/** Times each check of the given pairs on the DS's timer (the bus clock, 33.5 MHz); answers with the average or the slowest, in timer ticks. */
function timingItem(pairs: readonly Pair[], answer: "average" | "slowest"): DumpItem {
  const rows = pairs.map((p) => `{ ${[...row(p.a), ...row(p.b)].join(", ")} }`).join(",\n");
  return {
    setup: `
      static const int32_t rows[${pairs.length}][38] = {
${rows}
};
      uint32_t total = 0, slowest = 0;
      for (int k = 0; k < ${pairs.length}; k++) {
        const int32_t *r = rows[k];${FILL}
        cpuStartTiming(0);
        volatile int sink = gs_shapes_overlap(&first, &second);
        (void)sink;
        uint32_t ticks = cpuEndTiming();
        total += ticks;
        if (ticks > slowest) slowest = ticks;
      }`,
    expr: answer === "average" ? `total / ${pairs.length}` : "slowest"
  };
}

describe.skipIf(!toolchain.found)("collision shapes on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-collision-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const worked: Pair[] = WORKED_CASES;
  const random = SIZES.flatMap((size, k) =>
    KINDS.flatMap((a, i) => KINDS.map((b, j) => ({ a, b, size, cases: randomCases(a, b, size.perPair, 1000 * STRESS + k * 100 + i * 4 + j, size.factor) })))
  );
  const all: Pair[] = [...worked, ...random.flatMap((group) => group.cases)];
  let answers: boolean[] = [];
  let timings: Array<{ pair: string; average: number; slowest: number }> = [];

  beforeAll(async () => {
    const translated = translateScene3D(scriptedProject([{ name: "Empty", source: "func _ready():\n    pass\n" }]));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    // The test's main includes the generated script code; the collision API comes in with it.
    const scene: DsScene3D = { ...translated.scene, scriptCode: `${translated.scene.scriptCode}\n#include "gs_collision.h"\n` };
    const items: DumpItem[] = [];
    for (let i = 0; i < all.length; i += PER_ITEM) items.push(itemFor(all.slice(i, i + PER_ITEM)));
    const answerItems = items.length;
    // How long a check takes, for each pair of shape kinds, over its ordinary-size random cases.
    const ordinary = random.filter((group) => group.size.factor === 1);
    for (const group of ordinary) items.push(timingItem(group.cases.slice(0, PER_ITEM), "average"), timingItem(group.cases.slice(0, PER_ITEM), "slowest"));
    const { values } = await runDump(scene, items, work, "collision");
    answers = all.map((_, i) => ((values[Math.floor(i / PER_ITEM)] >>> i % PER_ITEM) & 1) === 1);
    timings = ordinary.map((group, i) => ({ pair: `${group.a} vs ${group.b}`, average: values[answerItems + i * 2], slowest: values[answerItems + i * 2 + 1] }));
  }, 300_000);

  worked.forEach((c, i) => {
    const expected = WORKED_CASES[i].expected;
    it(`${expected ? "overlap" : "apart"}: ${c.name}`, () => {
      expect(answers[i]).toBe(expected);
    });
  });

  let offset = worked.length;
  for (const group of random) {
    const start = offset;
    offset += group.cases.length;
    it(`${group.size.label} ${group.a} vs ${group.b}: agrees with the oracle on ${group.cases.length} random pairs (about half overlapping)`, () => {
      const wrong = group.cases.filter((c, i) => answers[start + i] !== c.clearance > 0).map((c) => `${c.name} (oracle clearance ${c.clearance.toFixed(3)}, DS said ${answers[start + group.cases.indexOf(c)] ? "overlap" : "apart"})`);
      expect(wrong).toEqual([]);
    });
  }

  it("tested both outcomes in every shape pair", () => {
    for (const group of random) {
      const overlapping = group.cases.filter((c) => c.clearance > 0).length;
      expect(overlapping).toBe(group.size.perPair / 2);
    }
  });

  it("takes well under a millisecond a check, on average, for every pair of shapes (and never a whole frame)", () => {
    const TICKS_PER_MS = 33513;
    console.info(
      "collision check cost on the DS (timer ticks at 33.5 MHz; 33513 = 1 ms):\n" +
        timings.map((t) => `  ${t.pair.padEnd(18)} average ${String(t.average).padStart(6)} (${(t.average / TICKS_PER_MS).toFixed(3)} ms), slowest ${String(t.slowest).padStart(6)} (${(t.slowest / TICKS_PER_MS).toFixed(3)} ms)`).join("\n")
    );
    expect(timings).toHaveLength(16);
    for (const t of timings) {
      expect(t.average, `${t.pair} averages ${t.average} ticks`).toBeGreaterThan(0);
      expect(t.average, `${t.pair} averages ${t.average} ticks`).toBeLessThan(TICKS_PER_MS); // under 1 ms
      expect(t.slowest, `${t.pair} slowest ${t.slowest} ticks`).toBeLessThan(TICKS_PER_MS * 4); // and a quarter of a frame at the worst
    }
  });
});
