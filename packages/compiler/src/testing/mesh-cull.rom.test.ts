import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MeshCullMode, ProjectSnapshot } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { lightProbeProject } from "../fixtures";
import { captureRom } from "./emulator-capture";

/**
 * Face culling on the DS, in a real ROM (requirements/scene-designer/STORY.mesh-face-culling.md). `lightProbeProject` is a flat
 * plane facing the camera head-on; whichever side is towards the camera in that setup is that plane's own "front", so culling
 * the front should make it vanish from view, culling the back should leave it exactly as visible as the default (culling
 * neither), and both should read the same grey the lighting tests already established for that setup.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
/** The 3D runtime's clear color (main.c: RGB15 3, 5, 10), as melonDS scales 5-bit color up to the 8-bit PNG it captures. */
const BACKDROP = [3, 5, 10].map((v) => Math.round((v * 255) / 31));
const BACKDROP_TOLERANCE = 14;

describe.skipIf(!toolchain.found)("mesh face culling in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-cull-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  /** Whether the middle of the screen is (still) the 3D backdrop (3, 5, 10) or something was drawn there. */
  async function middleIsBackdrop(name: string, project: ProjectSnapshot): Promise<boolean> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    const shot = captureRom(rom, join(work, `${name}.png`));
    const png = PNG.sync.read(readFileSync(shot.pngPath));
    const cx = Math.round(shot.screen.left + shot.screen.width / 2);
    const cy = Math.round(shot.screen.top + shot.screen.height / 2);
    const i = (cy * png.width + cx) * 4;
    return [0, 1, 2].every((c) => Math.abs(png.data[i + c] - BACKDROP[c]) <= BACKDROP_TOLERANCE);
  }

  const project = (cull: MeshCullMode | undefined) => lightProbeProject(0, cull ? { cull } : {});

  it("the default (no culling) shows the plane, facing the camera", async () => {
    expect(await middleIsBackdrop("default", project(undefined))).toBe(false);
  }, 90_000);

  it("culling the back leaves it just as visible: the camera is looking at the front", async () => {
    expect(await middleIsBackdrop("back", project("back"))).toBe(false);
  }, 90_000);

  it("culling the front makes it vanish: the camera is looking at exactly the side that's now culled", async () => {
    expect(await middleIsBackdrop("front", project("front"))).toBe(true);
  }, 90_000);
});
