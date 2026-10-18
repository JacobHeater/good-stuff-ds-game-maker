import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { captureRom } from "./emulator-capture";

/**
 * A SkyBox3D in a real ROM (requirements/scene-designer/STORY.sky-box.md). The gradient's own polygon has no real
 * world position a player could walk "past," so the one thing that actually matters on real hardware is that real
 * geometry anywhere within the camera's own far plane draws correctly in front of it -- not just a mesh placed a
 * couple of units away (what the feature's own first hardware pass checked), but one much farther out, the kind of
 * distant scenery (trees, buildings) a sky box exists to sit behind in the first place.
 *
 * A first version of this placed the gradient's own literal polygon a few scene units from the camera, relying on
 * alpha < 31 to skip the depth write entirely so later, farther geometry would always draw over it regardless of
 * distance. A real capture proved that wrong: a tree 15-35 units away vanished behind the sky box completely, while
 * one genuinely nearer than the sky's own few-unit placement stayed visible -- an ordinary "nearer wins" depth
 * test, not a skipped write. The fix places the gradient just inside the camera's own real far plane instead (full
 * 20.12 fixed-point precision via the modelview matrix's own translation, not a v16 vertex's own +-8 unit range --
 * see draw_sky_box's own comment in main.c), so it reliably loses an ordinary depth test to anything the camera can
 * actually see.
 *
 * A sky box's own gradient fills the whole screen, so `captureRom`'s own backdrop-color auto-detect (STORY.sky-box.md's
 * own note on this) can't find the screen in a capture that has one: every capture here that includes a sky box is
 * taken raw and sampled against a screen rect found from a sky-box-free capture of the exact same camera/scene
 * first.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const CAPTURE_SCRIPT = resolve(HERE, "..", "..", "..", "..", "tools", "ds-toolchain", "capture-melonds.ps1");

function project(treeZ: number | null, withSky: boolean): ProjectSnapshot {
  const camera = createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 10 }, rotation: { x: 0, y: 0, z: 0 } } });
  const sun = createSceneNode({ name: "Sun", kind: "DirectionalLight3D", transform3D: { position: { x: 0, y: 5, z: 5 }, rotation: { x: -45, y: -30, z: 0 } } });
  const children = [camera, sun];
  if (treeZ !== null) {
    children.unshift(createSceneNode({ name: "Tree", kind: "MeshInstance3D", mesh: "cube", transform3D: { position: { x: 0, y: 2, z: treeZ }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 3 } } }));
  }
  if (withSky) children.push(createSceneNode({ name: "Sky", kind: "SkyBox3D" }));
  return createProjectSnapshot({ name: "SkyBoxHardware", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children }) });
}

describe.skipIf(!toolchain.found)("a SkyBox3D in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-skybox-hw-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function buildRom(name: string, p: ProjectSnapshot): Promise<string> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(p, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return rom;
  }

  function sampleCenter(pngPath: string, rect: { left: number; top: number; width: number; height: number }) {
    const png = PNG.sync.read(readFileSync(pngPath));
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const i = (cy * png.width + cx) * 4;
    return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
  }

  async function captureRaw(name: string, p: ProjectSnapshot, rect: { left: number; top: number; width: number; height: number }) {
    const rom = await buildRom(name, p);
    const pngPath = join(work, `${name}.png`);
    const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Rom", rom, "-Out", pngPath, "-WaitSeconds", "3"], { encoding: "utf-8", timeout: 60_000 });
    if (run.status !== 0) throw new Error(`Capturing failed:\n${run.stdout}\n${run.stderr}`);
    return sampleCenter(pngPath, rect);
  }

  const isGrey = (c: { r: number; g: number; b: number }): boolean => Math.abs(c.r - c.g) < 10 && Math.abs(c.g - c.b) < 10 && c.r > 100;

  it(
    "draws real geometry near the edge of the default far plane (90 of 100 units) correctly in front of the sky box, not behind it",
    async () => {
      const baselineRom = await buildRom("tree-no-sky", project(-80, false));
      const baseline = captureRom(baselineRom, join(work, "tree-no-sky.png"), 3);
      expect(isGrey(sampleCenter(baseline.pngPath, baseline.screen)), `expected a grey cube, got a non-grey baseline`).toBe(true);

      const withSky = await captureRaw("tree-with-sky", project(-80, true), baseline.screen);
      expect(isGrey(withSky), `the tree 90 units away should draw in front of the sky box, not be hidden by it -- got ${JSON.stringify(withSky)}`).toBe(true);
    },
    90_000
  );

  it("still fills empty screen space with its own gradient when nothing is there", async () => {
    const baselineRom = await buildRom("empty-no-sky", project(null, false));
    const baseline = captureRom(baselineRom, join(work, "empty-no-sky.png"), 3);

    const empty = await captureRaw("empty-with-sky", project(null, true), baseline.screen);
    expect(isGrey(empty), `expected the sky's own gradient (not grey), got ${JSON.stringify(empty)}`).toBe(false);
  }, 90_000);
});
