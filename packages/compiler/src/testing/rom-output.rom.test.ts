import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { translateScene3D } from "../translate-scene-3d";
import { bottomScreenProject, cubeProject, fullBudgetProject, nestedProject, primitivesProject } from "../fixtures";
import { captureRom } from "./emulator-capture";
import { coveredPixels, referenceSilhouette, silhouetteIoU } from "./reference-render";

/**
 * Emulator regression tests: build each fixture into a real ROM, run it in melonDS, capture the top screen,
 * and compare what it drew with an independent three.js render of the same project. Slow (each ROM is a
 * few seconds), needs the DS toolchain and melonDS and a desktop session, and opens emulator windows, so it
 * isn't part of `pnpm test`. Run it with `pnpm test:rom`.
 *
 * See requirements/testing/TASK.compiler-and-rom-regression-tests.md.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(HERE, "..", "..", "runtime");
const IOU_MINIMUM = 0.85; // edges differ by about a pixel between the DS rasterizer and ours

const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "") ;

describe.skipIf(!toolchain.found || !haveMelon)("ROMs built from fixtures look like the reference render", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-rom-tests-"));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: RUNTIME_DIR });

  beforeAll(() => mkdirSync(work, { recursive: true }));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const fixtures = [
    ["cube", cubeProject],
    ["primitives", primitivesProject],
    ["nested (parent transforms, hidden branch)", nestedProject]
  ] as const;

  const captures = new Map<string, ReturnType<typeof captureRom>>();
  const capture = async (name: string, make: typeof cubeProject): Promise<ReturnType<typeof captureRom>> => {
    const cached = captures.get(name);
    if (cached) return cached;
    const romPath = join(work, `${name.split(" ")[0]}.nds`);
    const result = await compileProject(make(), romPath, builder);
    if (!result.ok) throw new Error(`Build failed: ${result.message}`);
    const shot = captureRom(romPath, join(work, `${name.split(" ")[0]}.png`));
    captures.set(name, shot);
    return shot;
  };

  for (const [name, make] of fixtures) {
    it(`${name}: the ROM boots at full speed and draws the reference silhouette`, async () => {
      const shot = await capture(name, make);
      console.info(`${name}: screen found at ${JSON.stringify(shot.screen)}`);
      expect(shot.title).toMatch(/\[60\/60\]/); // running at 60 of 60 frames per second
      const reference = referenceSilhouette(make());
      expect(coveredPixels(reference)).toBeGreaterThan(200); // the fixture actually shows something
      expect(coveredPixels(shot.silhouette)).toBeGreaterThan(200); // and so did the ROM
      const iou = silhouetteIoU(shot.silhouette, reference);
      if (iou < IOU_MINIMUM) writeFileSync(join(tmpdir(), `gsds-mismatch-${name.split(" ")[0]}.txt`), `IoU ${iou}\n${shot.pngPath}`);
      expect(iou).toBeGreaterThanOrEqual(IOU_MINIMUM);
    }, 90_000);
  }

  // A project authored through the real editor UI (tests/prototypes/e2e/ui-to-rom.mjs prints where it saved one).
  // This is the point of the exercise: what a user can build in the editor, compiled and run on a DS.
  it.skipIf(!process.env.GSDS_ROM_PROJECT)("a project authored in the editor UI compiles and matches its reference", async () => {
    const project = JSON.parse(readFileSync(process.env.GSDS_ROM_PROJECT!, "utf-8"));
    const shot = await capture("ui-authored", () => project);
    expect(shot.title).toMatch(/\[60\/60\]/);
    const reference = referenceSilhouette(project);
    const iou = silhouetteIoU(shot.silhouette, reference);
    console.info(`UI-authored project: IoU ${iou.toFixed(3)}, ${coveredPixels(reference)} px expected, ${coveredPixels(shot.silhouette)} px drawn`);
    copyFileSync(shot.pngPath, join(tmpdir(), "gsds-ui-authored-rom.png"));
    expect(iou).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 90_000);

  it("a scene assigned to the bottom screen is drawn on the bottom screen, not the top", async () => {
    const top = await capture("cube", cubeProject);
    const bottom = await capture("bottom", bottomScreenProject);
    expect(bottom.title).toMatch(/\[60\/60\]/);
    // Both pictures are of the same window, so the bottom screen sits below where the top screen was.
    expect(bottom.screen.top).toBeGreaterThanOrEqual(top.screen.top + top.screen.height - 2);
    expect(silhouetteIoU(bottom.silhouette, referenceSilhouette(bottomScreenProject()))).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 90_000);

  it("a scene at the full triangle budget still renders, and holds the frame rate", async () => {
    const project = fullBudgetProject();
    const triangles = translateScene3D(project).scene!.primitives[0].triangleCount * project.scene.children.filter((c) => c.kind === "MeshInstance3D").length;
    expect(triangles).toBeGreaterThan(2000); // the heaviest frame the compiler accepts
    expect(triangles).toBeLessThanOrEqual(2048);
    const shot = await capture("full-budget", fullBudgetProject);
    expect(shot.title).toMatch(/\[60\/60\]/);
    expect(silhouetteIoU(shot.silhouette, referenceSilhouette(project))).toBeGreaterThanOrEqual(0.8);
  }, 90_000);

  it("a 30 FPS scene builds and draws correctly", async () => {
    const romPath = join(work, "thirty.nds");
    const result = await compileProject(cubeProject(), romPath, builder, { fpsTarget: 30 });
    if (!result.ok) throw new Error(`Build failed: ${result.message}`);
    const shot = captureRom(romPath, join(work, "thirty.png"));
    // melonDS's title reports the emulator's own speed ("[60/60]" here too), not how often the 3D scene is
    // presented, so 30 FPS pacing (two vertical blanks per frame in main.c) can't be measured this way.
    // What can be checked is that the ROM built with that setting still draws the scene.
    expect(silhouetteIoU(shot.silhouette, referenceSilhouette(cubeProject()))).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 90_000);

  it("the check can fail: a ROM does not match a different scene's reference", async () => {
    const shot = await capture("cube", cubeProject);
    const wrong = referenceSilhouette(primitivesProject());
    expect(silhouetteIoU(shot.silhouette, wrong)).toBeLessThan(0.5);
  }, 90_000);

  it("the check is sensitive to placement: a mirrored scene doesn't match", async () => {
    const shot = await capture("primitives", primitivesProject);
    const mirrored = primitivesProject();
    for (const node of mirrored.scene.children) if (node.transform3D) node.transform3D.position.x *= -1;
    // The primitives are laid out left to right in different shapes; mirroring them must break the match.
    expect(silhouetteIoU(shot.silhouette, referenceSilhouette(mirrored))).toBeLessThan(IOU_MINIMUM);
  }, 90_000);
});
