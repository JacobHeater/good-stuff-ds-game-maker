import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withThreeDScreen, type ProjectSnapshot } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { cubeWithSpritesProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { referenceSilhouette, silhouetteIoU, type Silhouette } from "./reference-render";
import { BACKDROP_BLACK, covered, drawReference, matchRatio } from "./sprite-reference";

/**
 * Sprites on the 2D screen of a 3D project, in a real ROM (requirements/scene-designer/STORY.sprites-on-the-2d-screen-of-a-3d-project.md): the 3D engine draws the
 * cube on its screen (compared with the same three.js silhouette the other 3D tests use) while the sub engine shows the sprites on the other screen (compared pixel by
 * pixel with a reference painted from the project's own images), with the 3D scene on the top screen and on the bottom screen.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;
/** The 3D runtime's clear color as melonDS shows it (RGB15 3, 5, 10). */
const CLEAR = [28, 44, 85];

/** The pixels of a screen picture that are not the 3D backdrop: where the cube is. */
function silhouetteOf(rgb: Uint8Array): Silhouette {
  const mask = new Uint8Array(256 * 192);
  for (let i = 0; i < mask.length; i++) {
    const near = [0, 1, 2].every((c) => Math.abs(rgb[i * 3 + c] - CLEAR[c]) <= 14);
    mask[i] = near ? 0 : 1;
  }
  return { width: 256, height: 192, mask };
}

describe.skipIf(!toolchain.found || !haveMelon)("sprites on the 2D screen of a 3D project in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-sprites-3d-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(project: ProjectSnapshot, name: string, bluish: "top" | "bottom") {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return { diagnostics: built.diagnostics, screens: captureBothScreens(rom, join(work, `${name}.png`), 5, bluish) };
  }

  it("3D on the top screen: the cube is drawn on top and the sprites on the bottom screen, exactly", async () => {
    const project = cubeWithSpritesProject();
    const { diagnostics, screens } = await run(project, "top3d", "top");
    expect(diagnostics.filter((d) => d.severity === "error" || d.code === "two-d-node-not-built")).toEqual([]);
    const sprites = drawReference(project, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }).bottom;
    const ratio = matchRatio(screens.bottom, sprites);
    const cube = silhouetteIoU(silhouetteOf(screens.top), referenceSilhouette(project));
    console.info(`[sprites-3d] 3D on top: sprites match ${ratio.toFixed(4)} (${covered(screens.bottom, BACKDROP_BLACK)} sprite pixels), cube silhouette ${cube.toFixed(3)}`);
    expect(covered(screens.bottom, BACKDROP_BLACK), "the bottom screen has sprites on it").toBeGreaterThan(2000);
    expect(ratio).toBeGreaterThanOrEqual(0.995);
    expect(cube, "the cube is still drawn").toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 180_000);

  it("3D on the bottom screen: the sprites are on the top screen and the cube on the bottom", async () => {
    const base = cubeWithSpritesProject();
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const { screens } = await run(project, "bottom3d", "bottom");
    const sprites = drawReference(project, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }).top;
    const ratio = matchRatio(screens.top, sprites);
    const cube = silhouetteIoU(silhouetteOf(screens.bottom), referenceSilhouette(project));
    console.info(`[sprites-3d] 3D on bottom: sprites match ${ratio.toFixed(4)}, cube silhouette ${cube.toFixed(3)}`);
    expect(covered(screens.top, BACKDROP_BLACK)).toBeGreaterThan(2000);
    expect(ratio).toBeGreaterThanOrEqual(0.995);
    expect(cube).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 180_000);

  it("rotated and scaled sprites are drawn as the hardware's rotation matrix turns them: 90 degrees clockwise, mirrored, stretched, and 30 degrees", async () => {
    const base = cubeWithSpritesProject();
    const set = (name: string, transform2D: { rotation?: number; scale?: { x?: number; y?: number } }) => {
      const node = base.scene.children.find((n) => n.name === name)!;
      node.transform2D = transform2D;
    };
    set("Quad", { rotation: 90 }); // red is top-left of the picture: after a quarter turn clockwise it is top-right
    set("Diamond", { rotation: 30 });
    set("Wide", { scale: { x: 1, y: 2 } });
    set("Stripe", { scale: { x: -1 } }); // mirrored left to right
    const { screens } = await run(base, "rotated", "top");
    const ratio = matchRatio(screens.bottom, drawReference(base, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }).bottom);
    console.info(`[sprites-3d] rotated/scaled sprites match the reference by ${ratio.toFixed(4)}`);
    expect(ratio).toBeGreaterThanOrEqual(0.97);
  }, 180_000);

  it("a sprite a script rotates and hides doesn't crash the hardware (oamSetHidden on a rotate/scale sprite), and is actually hidden", async () => {
    // A script writing rotation makes the sprite affine ("rotate/scale"); a script writing visible then has to hide an affine sprite. The DS's
    // OAM reuses the same bit for "hidden" (ordinary sprites) and "double size" (affine ones), so libnds refuses to touch it on an affine sprite
    // (an assertion, printed right on the DS screen and halting) unless the runtime drops the sprite out of affine mode first.
    const base = cubeWithSpritesProject();
    const quad = base.scene.children.find((n) => n.name === "Quad")!;
    quad.scriptId = "spin-hide";
    const project: ProjectSnapshot = { ...base, scripts: [{ id: "spin-hide", name: "SpinHide", source: "func _ready():\n    rotation = 45.0\n    visible = false\n" }] };
    const { diagnostics, screens } = await run(project, "spin-hide", "top");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // What the screen should show: the same project, but with Quad hidden (its rotation doesn't matter once it's invisible) -- this is what
    // the script does by the time the first frame is captured, so the actual screen should match it closely if nothing crashed or mis-hid it.
    const expectedProject: ProjectSnapshot = { ...base, scene: { ...base.scene, children: base.scene.children.map((n) => (n.name === "Quad" ? { ...n, visible: false } : n)) } };
    const expectedBottom = drawReference(expectedProject, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }).bottom;
    const ratio = matchRatio(screens.bottom, expectedBottom);
    console.info(`[sprites-3d] rotated + hidden sprite: no crash, matches the hidden-Quad reference by ${ratio.toFixed(4)}`);
    expect(covered(screens.bottom, BACKDROP_BLACK), "the other three sprites are still on the bottom screen").toBeGreaterThan(500);
    expect(ratio).toBeGreaterThanOrEqual(0.99);
  }, 180_000);

  it("textures still work next to the sprites: a textured mesh keeps its picture with bank D given to the sprites", async () => {
    const { texturedProject } = await import("../fixtures");
    const textured = texturedProject();
    const withSprites = cubeWithSpritesProject();
    const project: ProjectSnapshot = { ...textured, sprites: withSprites.sprites, scene: { ...textured.scene, children: [...textured.scene.children, ...withSprites.scene.children.filter((n) => n.kind === "Sprite2D")] } };
    const { screens } = await run(project, "textured", "top");
    const cube = silhouetteIoU(silhouetteOf(screens.top), referenceSilhouette(project));
    const sprites = matchRatio(screens.bottom, drawReference(project, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }).bottom);
    console.info(`[sprites-3d] textured mesh + sprites: silhouette ${cube.toFixed(3)}, sprites ${sprites.toFixed(4)}`);
    expect(cube).toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(sprites).toBeGreaterThanOrEqual(0.995);
  }, 180_000);
});
