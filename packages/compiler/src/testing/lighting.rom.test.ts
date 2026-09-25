import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DS_PLAIN_MESH_DIFFUSE, dsVertexBrightness, lightLevelFromIntensity, type ProjectSnapshot } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { lightProbeProject } from "../fixtures";
import { captureRom } from "./emulator-capture";

/**
 * The DS lighting, checked in a real ROM against the formula in @goodstuff/core (ds-lighting.ts): a flat grey plane facing the
 * camera is one color, so the brightness of its middle IS the lighting result. These tests found the bug where a scaled mesh
 * lost the light (requirements/compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md): a plane scaled 3x read the same at every
 * angle. They need the toolchain and melonDS, so they run with `pnpm test:rom`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
/** melonDS turns the DS's 5-bit lighting into 8 bits a little below full scale (a full-brightness surface reads about 247). */
const TOLERANCE = 14;

describe.skipIf(!toolchain.found)("the DS lighting in a real ROM matches the formula", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-lighting-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  /** The brightness of the middle of the plane, 0..255, from an emulator capture. */
  async function measure(name: string, project: ProjectSnapshot): Promise<number> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    const shot = captureRom(rom, join(work, `${name}.png`));
    const png = PNG.sync.read(readFileSync(shot.pngPath));
    const cx = Math.round(shot.screen.left + shot.screen.width / 2);
    const cy = Math.round(shot.screen.top + shot.screen.height / 2);
    let sum = 0;
    let spread = 0;
    const values: number[] = [];
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const i = ((cy + dy) * png.width + cx + dx) * 4;
        const grey = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
        expect(Math.abs(png.data[i] - png.data[i + 1])).toBeLessThan(4); // it's grey: no color cast
        sum += grey;
        values.push(grey);
      }
    }
    spread = Math.max(...values) - Math.min(...values);
    expect(spread).toBeLessThan(6); // one flat color across the patch
    return sum / values.length;
  }
  /** What the formula says the plane should read for a light at `degrees` and `intensity` (null = no light). */
  const expected = (degrees: number | null, intensity = 1): number => {
    const lights =
      degrees === null
        ? []
        : [{ direction: [Math.sin((degrees * Math.PI) / 180), 0, -Math.cos((degrees * Math.PI) / 180)] as [number, number, number], level: lightLevelFromIntensity(intensity) }];
    return dsVertexBrightness([0, 0, 1], lights, DS_PLAIN_MESH_DIFFUSE) * 255;
  };
  const within = (actual: number, want: number): void => {
    expect(Math.abs(actual - want), `measured ${actual.toFixed(0)}, the formula says ${want.toFixed(0)}`).toBeLessThanOrEqual(TOLERANCE);
  };

  // The plane is scaled 3x in every one of these, as a real scene's meshes are: this is what used to break.
  for (const degrees of [0, 45, 60, 90]) {
    it(`a scaled plane lit at ${degrees} degrees reads what the formula gives`, async () => {
      within(await measure(`angle-${degrees}`, lightProbeProject(degrees)), expected(degrees));
    }, 90_000);
  }

  it("brightness follows the angle: straight on is much brighter than edge on", async () => {
    const straight = await measure("angle-0", lightProbeProject(0));
    const edge = await measure("angle-90", lightProbeProject(90));
    expect(straight - edge).toBeGreaterThan(120);
  }, 120_000);

  it("a scaled and an unscaled plane are lit the same", async () => {
    const scaled = await measure("angle-60", lightProbeProject(60));
    const unscaled = await measure("unscaled-60", lightProbeProject(60, { scale: { x: 1, y: 1, z: 1 } }));
    expect(Math.abs(scaled - unscaled)).toBeLessThanOrEqual(4);
  }, 120_000);

  it("a non-uniformly scaled plane is lit the same too", async () => {
    within(await measure("nonuniform", lightProbeProject(0, { scale: { x: 3, y: 1, z: 2 } })), expected(0));
  }, 90_000);

  it("light intensity dims the light: 50% reads the formula's value for a level-16 light", async () => {
    within(await measure("half", lightProbeProject(0, { intensity: 0.5 })), expected(0, 0.5));
    within(await measure("half-angled", lightProbeProject(60, { intensity: 0.5 })), expected(60, 0.5));
  }, 180_000);

  it("a light at 0% contributes nothing: the plane is black", async () => {
    expect(await measure("zero", lightProbeProject(0, { intensity: 0 }))).toBeLessThan(12);
  }, 90_000);

  it("a scene with no light is unlit, not black: the plane shows its own grey at full brightness", async () => {
    within(await measure("unlit", lightProbeProject(null)), expected(null));
  }, 90_000);
});
