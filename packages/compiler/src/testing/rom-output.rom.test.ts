import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { DEFAULTS, translateScene3D } from "../translate-scene-3d";
import {
  bottomScreenProject,
  cubeProject,
  fullBudgetProject,
  importedModelProject,
  nestedProject,
  primitivesProject,
  TEXTURED_CUBE_SCALE,
  TEXTURED_CUBE_X,
  TEXTURED_PLANE_X,
  texturedPrimitivesProject,
  texturedProject
} from "../fixtures";
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
    ["nested (parent transforms, hidden branch)", nestedProject],
    ["imported (an OBJ model, two instances sharing one table)", importedModelProject],
    ["textured (a picture on a plane and a cube)", texturedProject],
    ["textured-shapes (a picture on every primitive)", texturedPrimitivesProject]
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

  // A scripted project authored through the real editor UI (tests/prototypes/e2e/script-editor.mjs prints where it saved one): its script sets the
  // mesh's position to (1.2, 0.4) in _ready. The ROM must look like the equivalent static scene, and unlike the scene without the script.
  it.skipIf(!process.env.GSDS_SCRIPT_ROM_PROJECT)("a scripted project authored in the editor UI runs on the emulator and matches its static equivalent", async () => {
    const project = JSON.parse(readFileSync(process.env.GSDS_SCRIPT_ROM_PROJECT!, "utf-8"));
    const mesh = (root: any): any => (root.kind === "MeshInstance3D" ? root : root.children.map(mesh).find(Boolean));
    const equivalent = structuredClone(project);
    delete equivalent.scripts;
    delete mesh(equivalent.scene).scriptId;
    mesh(equivalent.scene).transform3D.position = { x: 1.2, y: 0.4, z: mesh(equivalent.scene).transform3D.position.z };
    const unscripted = structuredClone(equivalent);
    mesh(unscripted.scene).transform3D.position = mesh(project.scene).transform3D.position;
    const shot = await capture("ui-scripted", () => project);
    expect(shot.title).toMatch(/\[60\/60\]/);
    const iou = silhouetteIoU(shot.silhouette, referenceSilhouette(equivalent));
    const without = silhouetteIoU(shot.silhouette, referenceSilhouette(unscripted));
    console.info(`UI-authored scripted project: IoU ${iou.toFixed(3)} with the static equivalent, ${without.toFixed(3)} with the unscripted scene`);
    expect(iou).toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(without).toBeLessThan(iou);
  }, 90_000);

  it("a texture appears upright and unmirrored on a plane and on a cube's front face, in the source image's colors", async () => {
    const shot = await capture("textured (a picture on a plane and a cube)", texturedProject);
    expect(shot.title).toMatch(/\[60\/60\]/);
    const picture = PNG.sync.read(readFileSync(shot.pngPath));
    const { left, top, width, height } = shot.screen;
    // A pinhole camera at (0, 0, 6) looking down -Z: where does world (x, y) at a given depth land on the screen?
    const focal = height / 2 / Math.tan((DEFAULTS.fovDegrees / 2) * (Math.PI / 180));
    const at = (x: number, y: number, depth: number): [number, number] => [left + width / 2 + (focal * x) / depth, top + height / 2 - (focal * y) / depth];
    /** The average color of a small patch, so one blended pixel can't decide it. */
    const sample = ([cx, cy]: [number, number]): [number, number, number] => {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const i = (Math.round(cy + dy) * picture.width + Math.round(cx + dx)) * 4;
          r += picture.data[i];
          g += picture.data[i + 1];
          b += picture.data[i + 2];
          n++;
        }
      }
      return [r / n, g / n, b / n];
    };
    /** Which of the picture's four colors a sample is, allowing for lighting scaling it (the ratios stay). */
    const classify = ([r, g, b]: [number, number, number]): string => {
      const strong = Math.max(r, g, b);
      if (strong < 90) return `dark(${[r, g, b].map(Math.round)})`;
      const [hr, hg, hb] = [r, g, b].map((c) => c > strong * 0.6);
      if (hr && !hg && !hb) return "red";
      if (!hr && hg && !hb) return "green";
      if (!hr && !hg && hb) return "blue";
      if (hr && hg && !hb) return "yellow";
      return `mixed(${[r, g, b].map(Math.round)})`;
    };
    const expected = { topLeft: "red", topRight: "green", bottomLeft: "blue", bottomRight: "yellow" };
    // Each quadrant's center is a quarter of the picture's width from the middle.
    const quadrants = (cx: number, size: number, depth: number) => ({
      topLeft: classify(sample(at(cx - size / 4, size / 4, depth))),
      topRight: classify(sample(at(cx + size / 4, size / 4, depth))),
      bottomLeft: classify(sample(at(cx - size / 4, -size / 4, depth))),
      bottomRight: classify(sample(at(cx + size / 4, -size / 4, depth)))
    });
    // The plane is 2 wide at depth 6; the cube's front face is 1.8 wide, 0.9 nearer.
    expect(quadrants(TEXTURED_PLANE_X, 2, 6)).toEqual(expected);
    expect(quadrants(TEXTURED_CUBE_X, TEXTURED_CUBE_SCALE, 6 - TEXTURED_CUBE_SCALE / 2)).toEqual(expected);
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
