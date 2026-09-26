import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectSnapshot } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { spritesProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_2D_PROJECT as BACKDROP, covered, drawReference as paint, matchRatio } from "./sprite-reference";

/**
 * 2D sprites in a real ROM (requirements/compiler/STORY.compile-2d-scene-to-nds-rom.md): a project's sprites are built, run in melonDS and both
 * screens compared, pixel by pixel, with a reference drawn from the same images (`drawReference`, plain painter's algorithm, no DS code). Sprites
 * aren't filtered or lit, so unlike the 3D tests this is an exact comparison (within the emulator's color conversion). `GSDS_SPRITES_ROM_PROJECT`
 * runs the same comparison on a project saved by the editor (tests/prototypes/e2e/sprite-image.mjs prints where it saved one).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

const drawReference = (project: ProjectSnapshot): Record<"top" | "bottom", Uint8Array> => paint(project, BACKDROP);

describe.skipIf(!toolchain.found || !haveMelon)("2D sprites in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-sprites-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(project: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return { diagnostics: built.diagnostics, screens: captureBothScreens(rom, join(work, `${name}.png`)) };
  }

  it("draws every sprite of both screens where the project puts them, in tree order, with transparency", async () => {
    const project = spritesProject();
    const { diagnostics, screens } = await run(project, "fixture");
    expect(diagnostics).toEqual([]);
    const expected = drawReference(project);
    const top = matchRatio(screens.top, expected.top);
    const bottom = matchRatio(screens.bottom, expected.bottom);
    console.info(`[sprites] match with the reference: top ${top.toFixed(4)}, bottom ${bottom.toFixed(4)}; ${covered(screens.top, BACKDROP.top)} / ${covered(screens.bottom, BACKDROP.bottom)} sprite pixels`);
    // Not vacuous: the reference has sprites, so a blank screen must not pass.
    expect(covered(expected.top, BACKDROP.top)).toBeGreaterThan(2000);
    expect(covered(screens.top, BACKDROP.top)).toBeGreaterThan(2000);
    expect(covered(screens.bottom, BACKDROP.bottom)).toBeGreaterThan(2000);
    expect(top).toBeGreaterThanOrEqual(0.995);
    expect(bottom).toBeGreaterThanOrEqual(0.995);
    // ... and the comparison notices a wrong picture: the bottom screen is nothing like the top's reference.
    expect(matchRatio(screens.bottom, expected.top)).toBeLessThan(0.9);
  }, 180_000);

  it("draws the sprite that comes later in the tree over the earlier one", async () => {
    const project = spritesProject();
    // Swap the two overlapping top sprites' places in the tree: now the quadrants are drawn over the diamond.
    const [quad, diamond, ...rest] = project.scene.children;
    const swapped: ProjectSnapshot = { ...project, scene: { ...project.scene, children: [diamond, quad, ...rest] } };
    const { screens } = await run(swapped, "swapped");
    const ratio = matchRatio(screens.top, drawReference(swapped).top);
    console.info(`[sprites] swapped order: top match ${ratio.toFixed(4)}`);
    expect(ratio).toBeGreaterThanOrEqual(0.995);
    // The two orders really do differ on this screen.
    expect(matchRatio(drawReference(project).top, drawReference(swapped).top)).toBeLessThan(0.999);
  }, 180_000);

  it.skipIf(!process.env.GSDS_SPRITES_ROM_PROJECT)("draws a project made in the editor UI as the editor placed it", async () => {
    const saved = JSON.parse(readFileSync(process.env.GSDS_SPRITES_ROM_PROJECT!, "utf-8")) as ProjectSnapshot;
    const { diagnostics, screens } = await run(saved, "ui");
    console.info(`[sprites] editor project diagnostics: ${diagnostics.map((d) => d.code).join(", ") || "none"}`);
    const expected = drawReference(saved);
    const top = matchRatio(screens.top, expected.top);
    const bottom = matchRatio(screens.bottom, expected.bottom);
    console.info(`[sprites] editor project match: top ${top.toFixed(4)}, bottom ${bottom.toFixed(4)}`);
    expect(top).toBeGreaterThanOrEqual(0.995);
    expect(bottom).toBeGreaterThanOrEqual(0.995);
  }, 180_000);
});
