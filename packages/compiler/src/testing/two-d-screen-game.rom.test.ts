import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { captureRom } from "./emulator-capture";
import { referenceSilhouette, silhouetteIoU } from "./reference-render";

/**
 * A 3D project whose 2D screen was chosen in the editor UI, run on the emulator (requirements/scene-designer/STORY.choose-2d-screen-in-3d-project.md;
 * tests/prototypes/e2e/two-d-screen.mjs prints where it saved one, and GSDS_TWO_D_ROM_PROJECT=<that path> runs this). The project has 2D on the TOP screen, a cube, a
 * camera, a light and a Label for the 2D screen. The 3D must be drawn on the BOTTOM screen, where the same project with 2D on the bottom draws it on the top; the ROM
 * does not draw the Label yet, so the 2D screen stays blank.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

describe.skipIf(!toolchain.found || !haveMelon || !process.env.GSDS_TWO_D_ROM_PROJECT)("a 3D project with its 2D screen on top, made in the editor UI, in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-two-d-screen-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  it("draws the 3D on the bottom screen, and the same project with the 2D screen swapped draws it on the top screen", async () => {
    const saved = JSON.parse(readFileSync(process.env.GSDS_TWO_D_ROM_PROJECT!, "utf-8"));
    expect(saved.scene.screen, "the project has 3D on the bottom").toBe("bottom");

    // The same project with the screens swapped by hand: every 3D node on the top, the Label on the bottom.
    const swapped = structuredClone(saved);
    const swap = (node: any): void => {
      node.screen = node.kind === "Label" ? "bottom" : "top";
      node.children.forEach(swap);
    };
    swap(swapped.scene);

    const build = async (project: unknown, name: string) => {
      const rom = join(work, `${name}.nds`);
      const built = await compileProject(project as never, rom, builder);
      if (!built.ok) throw new Error(`Build failed: ${built.message}`);
      expect(built.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code)).toEqual(["two-d-node-not-built"]);
      return captureRom(rom, join(work, `${name}.png`));
    };
    const top = await build(swapped, "top");
    const bottom = await build(saved, "bottom");
    console.info(`[two-d-screen] 3D on top: screen found at y ${top.screen.top}; 3D on bottom: y ${bottom.screen.top}`);

    // Both pictures are of the same window, so the bottom screen sits below where the top screen was.
    expect(bottom.screen.top).toBeGreaterThanOrEqual(top.screen.top + top.screen.height - 2);
    const onTop = silhouetteIoU(top.silhouette, referenceSilhouette(swapped));
    const onBottom = silhouetteIoU(bottom.silhouette, referenceSilhouette(saved));
    console.info(`[two-d-screen] silhouette overlap with the reference render: top ${onTop.toFixed(3)}, bottom ${onBottom.toFixed(3)}`);
    expect(onTop).toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(onBottom).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 300_000);
});
