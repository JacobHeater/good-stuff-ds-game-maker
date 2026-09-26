import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import { cubeProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/** randi, randf and atan2 on the DS's CPU (requirements/scripting/STORY.random-and-atan2.md). */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

describe.skipIf(!toolchain.found)("randi, randf and atan2 on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-math-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let values: number[] = [];
  const cases: Array<{ name: string; setup?: string; expr: string; check: (v: number) => void }> = [];
  const angle = (y: number, x: number, expected: number) =>
    cases.push({ name: `atan2(${y}, ${x}) is ${expected} degrees (within half a degree)`, expr: `gs_atan2(${F(y)}, ${F(x)})`, check: (v) => expect(Math.abs(v / 4096 - expected)).toBeLessThan(0.5) });
  angle(1, 1, 45);
  angle(1, 0, 90);
  angle(0, 1, 0);
  angle(0, -1, 180);
  angle(-1, 0, -90);
  angle(-1, -1, -135);
  angle(1, -1, 135);
  angle(1, 3, 18.43);
  angle(3, 1, 71.57);
  angle(-2, 5, -21.8);
  angle(0, 0, 0);
  cases.push({ name: "randi(6) is always 0 to 5, and all six turn up in 300 tries", setup: "int seen = 0; int bad = 0; for (int i = 0; i < 300; i++) { int v = gs_randi(6); if (v < 0 || v > 5) bad = 1; else seen |= 1 << v; }", expr: "bad * 1000 + seen", check: (v) => expect(v).toBe(63) });
  cases.push({ name: "randi(0) and randi(-3) are 0", expr: "gs_randi(0) + gs_randi(-3)", check: (v) => expect(v).toBe(0) });
  cases.push({ name: "randf() is from 0 up to below 1, and spreads across it (both halves in 300 tries)", setup: "int low = 0, high = 0, bad = 0; for (int i = 0; i < 300; i++) { int32_t v = gs_randf(); if (v < 0 || v >= 4096) bad = 1; else if (v < 2048) low++; else high++; }", expr: "bad * 100000 + (low > 60) * 10 + (high > 60)", check: (v) => expect(v).toBe(11) });

  beforeAll(async () => {
    const translated = translateScene3D(cubeProject());
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup, expr: c.expr }));
    values = (await runDump(translated.scene!, items, work, "math-builtins", 6)).values;
  }, 300_000);

  it.each(cases.map((c, i) => [c.name, i] as const))("%s", (_name, i) => cases[i].check(values[i]));
});
