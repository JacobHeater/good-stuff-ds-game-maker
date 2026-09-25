import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findSceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { scriptedProject } from "../fixtures";
import { bottomScreenPoint, captureRomWithInput } from "./emulator-capture";
import { DS_HEIGHT, DS_WIDTH, referenceSilhouette, silhouetteIoU, type Silhouette } from "./reference-render";

/**
 * Buttons and the touch screen, on the emulator, with real input: keys are pressed in melonDS's window and the screen is clicked (see
 * tools/ds-toolchain/melonds-input.ps1). A script moves the cube according to what is pressed, and the picture is compared with a render of
 * the cube where it should be. Needs melonDS with its default key bindings and a desktop session.
 *
 * Requirements: requirements/scripting/STORY.write-and-run-scripts.md ("Scripts read buttons and the touch screen").
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

type Project = ReturnType<typeof scriptedProject>;

const cubeAt = (x: number, y: number): Project => {
  const project = scriptedProject([]);
  Object.assign(findSceneNode(project.scene, project.scene.children.find((n) => n.name === "Cube")!.id)!.transform3D!.position, { x, y });
  return project;
};

/** The mean column and row of the covered pixels: where the cube is on the screen. */
function centroid(s: Silhouette): { x: number; y: number; pixels: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < s.mask.length; i++) {
    if (!s.mask[i]) continue;
    sx += i % DS_WIDTH;
    sy += Math.floor(i / DS_WIDTH);
    n++;
  }
  return { x: n ? sx / n : NaN, y: n ? sy / n : NaN, pixels: n };
}
void DS_HEIGHT;

describe.skipIf(!toolchain.found || !haveMelon)("scripts read the buttons and the touch screen in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-script-input-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function build(name: string, source: string): Promise<string> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(scriptedProject([{ name: "Input", source }]), rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return rom;
  }

  it("a held button is read every frame: the cube moves left while Left is held, and not when it isn't", async () => {
    const rom = await build("hold", 'func _process(delta):\n    if Input.is_button_down("left"):\n        position.x -= 0.02\n');
    const idle = captureRomWithInput(rom, join(work, "hold-idle.png"), { holdSeconds: 1.5 });
    expect(silhouetteIoU(idle.silhouette, referenceSilhouette(cubeAt(0, 0))), "nothing pressed: the cube stays where the scene put it").toBeGreaterThanOrEqual(IOU_MINIMUM);

    const held = captureRomWithInput(rom, join(work, "hold-held.png"), { hold: ["left"], holdSeconds: 1.5 });
    // 1.5 s at 60 frames a second is about 90 frames of 0.02: roughly 1.8 units to the left. Find where the reference cube is the same distance from the idle one.
    const idleX = centroid(idle.silhouette).x;
    const heldX = centroid(held.silhouette).x;
    const positions = [-0.5, -1, -1.5, -2, -2.5, -3].map((x) => ({ x, shift: idleX - centroid(referenceSilhouette(cubeAt(x, 0))).x }));
    const measured = idleX - heldX;
    console.info(`[script-input] Left held for 1.5 s: the cube moved ${measured.toFixed(1)} px left (the reference moves ${positions.map((p) => `${p.x}: ${p.shift.toFixed(1)}`).join(", ")})`);
    expect(measured, "the cube moved left").toBeGreaterThan(centroidShift(positions, -0.5));
    expect(measured, "and not by an implausible distance for 1.5 s of frames").toBeLessThan(centroidShift(positions, -3));
  }, 240_000);

  it("is_button_pressed is true for one frame only, however long the button is held or tapped", async () => {
    // Every press adds 0.5 to y; every release adds 0.5 to x. One tap (6 frames down) must move the cube by 0.5 in each, not by 3.
    const rom = await build("tap", 'func _process(delta):\n    if Input.is_button_pressed("a"):\n        position.y += 0.5\n    if Input.is_button_released("a"):\n        position.x += 0.5\n');
    const tapped = captureRomWithInput(rom, join(work, "tap.png"), { tap: ["a"], holdSeconds: 1.2 });
    const once = silhouetteIoU(tapped.silhouette, referenceSilhouette(cubeAt(0.5, 0.5)));
    const many = silhouetteIoU(tapped.silhouette, referenceSilhouette(cubeAt(3, 3)));
    console.info(`[script-input] one tap of A: matches the cube moved by (0.5, 0.5) ${once.toFixed(3)}, by (3, 3) ${many.toFixed(3)}`);
    expect(once).toBeGreaterThanOrEqual(IOU_MINIMUM);

    // Two taps: twice as far.
    const twice = captureRomWithInput(rom, join(work, "tap2.png"), { tap: ["a", "a"], holdSeconds: 1.2 });
    expect(silhouetteIoU(twice.silhouette, referenceSilhouette(cubeAt(1, 1)))).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 240_000);

  it("different buttons are different buttons: B moves the cube, A doesn't", async () => {
    const rom = await build("buttons", 'func _process(delta):\n    if Input.is_button_pressed("b"):\n        position.y += 0.6\n    if Input.is_button_pressed("start"):\n        position.x += 0.6\n');
    const b = captureRomWithInput(rom, join(work, "b.png"), { tap: ["b"], holdSeconds: 1 });
    expect(silhouetteIoU(b.silhouette, referenceSilhouette(cubeAt(0, 0.6)))).toBeGreaterThanOrEqual(IOU_MINIMUM);
    const start = captureRomWithInput(rom, join(work, "start.png"), { tap: ["start"], holdSeconds: 1 });
    expect(silhouetteIoU(start.silhouette, referenceSilhouette(cubeAt(0.6, 0)))).toBeGreaterThanOrEqual(IOU_MINIMUM);
    const a = captureRomWithInput(rom, join(work, "a.png"), { tap: ["a"], holdSeconds: 1 });
    expect(silhouetteIoU(a.silhouette, referenceSilhouette(cubeAt(0, 0)))).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 240_000);

  it("the touch screen gives the touched position: the cube goes where the screen is touched", async () => {
    // Touch (192, 48) on the 256 x 192 bottom screen -> x = (192 - 128) / 64 = 1.0, y = (96 - 48) / 64 = 0.75.
    const source = "func _process(delta):\n    if Input.is_touching():\n        position.x = float(Input.touch_x() - 128) / 64.0\n        position.y = float(96 - Input.touch_y()) / 64.0\n";
    const rom = await build("touch", source);
    const idle = captureRomWithInput(rom, join(work, "touch-idle.png"), { holdSeconds: 1 });
    expect(silhouetteIoU(idle.silhouette, referenceSilhouette(cubeAt(0, 0))), "not touching: the cube stays put").toBeGreaterThanOrEqual(IOU_MINIMUM);

    const point = bottomScreenPoint(idle, 192 / 256, 48 / 192);
    const touched = captureRomWithInput(rom, join(work, "touch.png"), { click: point, holdSeconds: 1 });
    const agreement = silhouetteIoU(touched.silhouette, referenceSilhouette(cubeAt(1, 0.75)));
    console.info(`[script-input] touched (192, 48): the cube matches one at (1, 0.75) by ${agreement.toFixed(3)}`);
    expect(agreement).toBeGreaterThanOrEqual(IOU_MINIMUM);
    // And a different touch goes somewhere else: (64, 144) is x = -1, y = -0.75.
    const other = captureRomWithInput(rom, join(work, "touch2.png"), { click: bottomScreenPoint(idle, 64 / 256, 144 / 192), holdSeconds: 1 });
    expect(silhouetteIoU(other.silhouette, referenceSilhouette(cubeAt(-1, -0.75)))).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 240_000);
});

/** The distance the reference cube's centroid moved when the cube was at `x`. */
function centroidShift(positions: Array<{ x: number; shift: number }>, x: number): number {
  return positions.find((p) => p.x === x)!.shift;
}
