import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, findSceneNode, withThreeDScreen, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { scriptedProject } from "../fixtures";
import { captureRomWithInput, type InputCapture } from "./emulator-capture";
import { DS_HEIGHT, DS_WIDTH, projectToScreen, referenceSilhouette, silhouetteIoU, type Silhouette } from "./reference-render";

/**
 * Touch areas on the emulator with a real stylus (requirements/touch/TASK.compile-touch-areas.md): a script moves the cube while a touch area is touched, the
 * screen is clicked in melonDS's window (tools/ds-toolchain/melonds-input.ps1) and the picture is compared with a render of the cube where it should be.
 * The TouchArea2D is a rectangle on the bottom screen, tested against the touched pixel; the TouchArea3D is a volume in the scene, hit by a ray from the camera
 * through the touched pixel, with the 3D scene on the bottom screen so the stylus can reach it. Where a click on the 3D scene should land is worked out with
 * three.js (`projectToScreen`), independently of the DS's own ray math. Needs melonDS with its default key bindings and a desktop session.
 * (`is_touch_released()` is not exercised here: the input tool holds a touch while the picture is taken, so a lift can't be observed.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

const cubeAt = (project: ProjectSnapshot, x: number, y = 0, z = 0): ProjectSnapshot => {
  const copy = structuredClone(project);
  const cube = copy.scene.children.find((n) => n.name === "Cube")!;
  Object.assign(findSceneNode(copy.scene, cube.id)!.transform3D!.position, { x, y, z });
  return copy;
};

const button = (): SceneNode => ({
  ...createSceneNode({ name: "Button", kind: "TouchArea2D", screen: "bottom", position: { x: 192, y: 48 } }),
  touchArea2D: { width: 64, height: 48 } // covers x 160..223, y 24..71
});
const pick = (overrides: Partial<SceneNode> = {}): SceneNode => ({
  ...createSceneNode({ name: "Pick", kind: "TouchArea3D" }),
  touchArea3D: { shape: "box", size: { x: 1, y: 1, z: 1 } },
  ...overrides
});

/** Where the centre of the 3D screen's DS pixel (x, y) is on the desktop, given a capture that found that screen. */
function pixelOf(capture: InputCapture, x: number, y: number): { x: number; y: number } {
  const { screen, window } = capture;
  return { x: window.left + screen.left + ((x + 0.5) / DS_WIDTH) * screen.width, y: window.top + screen.top + ((y + 0.5) / DS_HEIGHT) * screen.height };
}
/** The touch screen is directly below the top screen, so its pixel is one screen-height lower than the top screen's. */
function bottomPixelOf(capture: InputCapture, x: number, y: number): { x: number; y: number } {
  const p = pixelOf(capture, x, y);
  return { x: p.x, y: p.y + capture.screen.height };
}
function centroid(s: Silhouette): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < s.mask.length; i++) if (s.mask[i]) { sx += i % DS_WIDTH; sy += Math.floor(i / DS_WIDTH); n++; }
  return { x: sx / n, y: sy / n };
}

describe.skipIf(!toolchain.found || !haveMelon)("touch areas answer a real stylus in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-touch-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function build(name: string, project: ProjectSnapshot): Promise<string> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return rom;
  }
  const agrees = (capture: InputCapture, project: ProjectSnapshot): number => silhouetteIoU(capture.silhouette, referenceSilhouette(project));

  /**
   * A touch that should be seen: the stylus goes down at a point worked out from where the emulator's window was in an earlier run, and a click that lands
   * while the window is still settling (or a run that is slow to start) is simply lost, so a touch that has no effect is tried again, with the geometry measured
   * afresh, up to three times. Returns the best agreement with the expected picture. (Only ever used for touches that are expected to hit: a click that is lost
   * looks the same as a miss, so a miss is only believed after a hit has been seen on the same ROM.)
   */
  function touchSeen(rom: string, name: string, at: (geometry: InputCapture) => { x: number; y: number }, expected: ProjectSnapshot, holdSeconds = 1.5): { score: number; capture: InputCapture } {
    let geometry = captureRomWithInput(rom, join(work, `${name}-geometry.png`), { holdSeconds: 1 });
    let best = { score: -1, capture: geometry };
    for (let attempt = 1; attempt <= 3 && best.score < IOU_MINIMUM; attempt++) {
      const capture = captureRomWithInput(rom, join(work, `${name}-touch-${attempt}.png`), { click: at(geometry), holdSeconds });
      const score = agrees(capture, expected);
      if (score > best.score) best = { score, capture };
      if (score < IOU_MINIMUM) geometry = captureRomWithInput(rom, join(work, `${name}-geometry-${attempt}.png`), { holdSeconds: 1 });
    }
    return best;
  }

  it("a TouchArea2D is touched inside its rectangle and not outside it", async () => {
    const source = "func _process(delta):\n    if $Button.is_touched():\n        position.x = 1.0\n    else:\n        position.x = 0.0\n";
    const project = scriptedProject([{ source }], [button()]);
    const rom = await build("rect", project);
    const idle = captureRomWithInput(rom, join(work, "rect-idle.png"), { holdSeconds: 1 });
    expect(agrees(idle, cubeAt(project, 0)), "not touching: the cube stays put").toBeGreaterThanOrEqual(IOU_MINIMUM);

    // Just inside the rectangle's corners and its centre: touched. (The rectangle is x 160..223, y 24..71.)
    for (const [x, y] of [[192, 48], [166, 30], [218, 66]]) {
      const { score } = touchSeen(rom, `rect-in-${x}-${y}`, (geometry) => bottomPixelOf(geometry, x, y), cubeAt(project, 1));
      console.info(`[touch] 2D area, touch (${x}, ${y}) inside: the cube matches x = 1 by ${score.toFixed(3)}`);
      expect(score, `touching (${x}, ${y}) is inside the rectangle`).toBeGreaterThanOrEqual(IOU_MINIMUM);
    }
    // Outside, each side of it and far away: not touched.
    for (const [x, y] of [[150, 48], [235, 48], [192, 15], [192, 82], [64, 144]]) {
      const missed = captureRomWithInput(rom, join(work, `rect-out-${x}-${y}.png`), { click: bottomPixelOf(idle, x, y), holdSeconds: 1 });
      expect(agrees(missed, cubeAt(project, 0)), `touching (${x}, ${y}) is outside the rectangle`).toBeGreaterThanOrEqual(IOU_MINIMUM);
    }
  }, 600_000);

  it("is_touch_pressed() is true for one frame only, however long the stylus is held", async () => {
    // Every press counts once: a cube that moves up by 0.4 a press would be far above a press-per-frame count after a second of holding.
    const source = "var presses = 0\nfunc _process(delta):\n    if $Button.is_touch_pressed():\n        presses += 1\n    position.y = float(presses) * 0.4\n";
    const project = scriptedProject([{ source }], [button()]);
    const rom = await build("pressed", project);
    const idle = captureRomWithInput(rom, join(work, "pressed-idle.png"), { holdSeconds: 1 });
    expect(agrees(idle, cubeAt(project, 0, 0))).toBeGreaterThanOrEqual(IOU_MINIMUM);
    const { score } = touchSeen(rom, "pressed", (geometry) => bottomPixelOf(geometry, 192, 48), cubeAt(project, 0, 0.4), 2);
    console.info(`[touch] pressed once, held 2 s: the cube matches y = 0.4 by ${score.toFixed(3)}`);
    expect(score).toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 600_000);

  it("a TouchArea3D is hit by a ray through the touched pixel: on the object, but not beside it", async () => {
    const source = "func _process(delta):\n    if $Pick.is_touched():\n        position.x = 1.5\n    else:\n        position.x = 0.0\n";
    const base = scriptedProject([{ source }], [pick()]);
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const rom = await build("volume", project);
    // The 3D scene is on the bottom screen, so the capture finds the bottom screen: its pixels are where the stylus goes.
    const idle = captureRomWithInput(rom, join(work, "volume-idle.png"), { holdSeconds: 1 });
    expect(agrees(idle, cubeAt(project, 0)), "not touching: the cube stays put").toBeGreaterThanOrEqual(IOU_MINIMUM);

    // The centre of the cube, and the origin where its touch box is (three.js says where that is on the screen).
    const origin = projectToScreen(project, [0, 0, 0]);
    const seen = centroid(idle.silhouette);
    console.info(`[touch] 3D area: origin projects to (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)}), the cube's centroid is (${seen.x.toFixed(1)}, ${seen.y.toFixed(1)})`);
    const on = touchSeen(rom, "volume-on", (geometry) => pixelOf(geometry, Math.round(origin.x), Math.round(origin.y)), cubeAt(project, 1.5));
    expect(on.score, "touching the object moves the cube").toBeGreaterThanOrEqual(IOU_MINIMUM);

    // Well off the object (the corners and the far right of the screen): a ray that misses the box.
    for (const [x, y] of [[8, 8], [248, 184], [240, 96], [128, 186]]) {
      const missed = captureRomWithInput(rom, join(work, `volume-off-${x}-${y}.png`), { click: pixelOf(idle, x, y), holdSeconds: 1 });
      expect(agrees(missed, cubeAt(project, 0)), `touching (${x}, ${y}) misses the box`).toBeGreaterThanOrEqual(IOU_MINIMUM);
    }
  }, 600_000);

  it("the touch volume follows its node's scale: stretched along X, it is hit where the unscaled box is not", async () => {
    // A 1 x 1 x 1 box scaled 3 times along X reaches x = +-1.5. World point (1.3, 0, 0) is inside it and far outside the unscaled box.
    const source = "func _process(delta):\n    if $Pick.is_touched():\n        position.y = 1.0\n    else:\n        position.y = 0.0\n";
    const wide = pick({ transform3D: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 1 } } });
    const base = scriptedProject([{ source }], [wide]);
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const rom = await build("scaled", project);
    const idle = captureRomWithInput(rom, join(work, "scaled-idle.png"), { holdSeconds: 1 });
    const inside = projectToScreen(project, [1.3, 0, 0]);
    const outside = projectToScreen(project, [1.9, 0, 0]);
    console.info(`[touch] scaled box: (1.3, 0, 0) is at (${inside.x.toFixed(1)}, ${inside.y.toFixed(1)}); (1.9, 0, 0) at (${outside.x.toFixed(1)}, ${outside.y.toFixed(1)})`);
    const hit = touchSeen(rom, "scaled-in", (geometry) => pixelOf(geometry, Math.round(inside.x), Math.round(inside.y)), cubeAt(project, 0, 1));
    expect(hit.score, "inside the stretched box").toBeGreaterThanOrEqual(IOU_MINIMUM);
    const miss = captureRomWithInput(rom, join(work, "scaled-out.png"), { click: pixelOf(idle, Math.round(outside.x), Math.round(outside.y)), holdSeconds: 1 });
    expect(agrees(miss, cubeAt(project, 0, 0)), "beyond the stretched box").toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 600_000);

  it("Input.touch_ground_x / _z give the world point on a flat plane under the stylus: the cube goes to where it is touched", async () => {
    // A big, flat touch box (6 x 1 x 6) around the origin so the ray through any touched point on the plane is inside it; while it is touched the cube is set to the
    // point of the plane at height 0 the stylus points at. Where that point is on the screen comes from three.js, independently of the DS's ray-plane math.
    const source = "func _process(delta):\n    if $Pick.is_touched():\n        position.x = Input.touch_ground_x(0.0)\n        position.z = Input.touch_ground_z(0.0)\n";
    const floor = pick({ touchArea3D: { shape: "box", size: { x: 6, y: 1, z: 6 } } });
    const base = scriptedProject([{ source }], [floor]);
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const rom = await build("ground", project);
    for (const [wx, wz] of [[1.5, -1.0], [-1.2, 1.0]]) {
      const at = projectToScreen(project, [wx, 0, wz]);
      const seen = touchSeen(rom, `ground-${wx}-${wz}`, (geometry) => pixelOf(geometry, Math.round(at.x), Math.round(at.y)), cubeAt(project, wx, 0, wz));
      console.info(`[touch] ground plane: touching where (${wx}, 0, ${wz}) projects, (${at.x.toFixed(1)}, ${at.y.toFixed(1)}): the cube matches by ${seen.score.toFixed(3)}`);
      expect(seen.score, `the cube goes to (${wx}, 0, ${wz})`).toBeGreaterThanOrEqual(IOU_MINIMUM);
      // ... and it is not just anywhere: the cube at the other point does not match.
      expect(agrees(seen.capture, cubeAt(project, -wx, 0, -wz))).toBeLessThan(IOU_MINIMUM);
    }
  }, 600_000);

  it("a touch goes to one area: with two volumes on the same ray only the nearer one is pressed", async () => {
    // Two 1 x 1 x 1 boxes on the line from the camera to the origin: Far at the origin, Near about half way to the camera. Touching where the origin is seen goes
    // through both; the script moves the cube right for Near and up for Far, so a cube at (1, 0) means only Near was pressed, and (1, 1) would mean both were.
    const source = "func _process(delta):\n    if $Near.is_touch_pressed():\n        position.x = 1.0\n    if $Far.is_touch_pressed():\n        position.y = 1.0\n";
    const near = pick({ name: "Near", transform3D: { position: { x: 1.2, y: 0.96, z: 1.68 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    const far = pick({ name: "Far" });
    const base = scriptedProject([{ source }], [far, near]);
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const rom = await build("nearest", project);
    const centre = projectToScreen(project, [0, 0, 0]);
    const seen = touchSeen(rom, "nearest", (geometry) => pixelOf(geometry, Math.round(centre.x), Math.round(centre.y)), cubeAt(project, 1, 0));
    console.info(`[touch] two volumes on the ray: the cube matches (1, 0) by ${seen.score.toFixed(3)}, (1, 1) by ${agrees(seen.capture, cubeAt(project, 1, 1)).toFixed(3)}`);
    expect(seen.score, "only the nearer box was pressed").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(agrees(seen.capture, cubeAt(project, 1, 1)), "the farther box was not pressed too").toBeLessThan(IOU_MINIMUM);
  }, 600_000);

  it("a sphere is hit through its middle and missed just outside its radius", async () => {
    const source = "func _process(delta):\n    if $Pick.is_touched():\n        position.x = 1.5\n    else:\n        position.x = 0.0\n";
    const ball = pick({ touchArea3D: { shape: "sphere", radius: 0.5 } });
    const base = scriptedProject([{ source }], [ball]);
    const project: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const rom = await build("sphere", project);
    const idle = captureRomWithInput(rom, join(work, "sphere-idle.png"), { holdSeconds: 1 });
    const middle = projectToScreen(project, [0, 0, 0]);
    // A point well outside the sphere on the screen: a world point 1 unit up is twice the radius away.
    const above = projectToScreen(project, [0, 1.2, 0]);
    const hit = touchSeen(rom, "sphere-in", (geometry) => pixelOf(geometry, Math.round(middle.x), Math.round(middle.y)), cubeAt(project, 1.5));
    expect(hit.score, "through the sphere's middle").toBeGreaterThanOrEqual(IOU_MINIMUM);
    const miss = captureRomWithInput(rom, join(work, "sphere-out.png"), { click: pixelOf(idle, Math.round(above.x), Math.round(above.y)), holdSeconds: 1 });
    expect(agrees(miss, cubeAt(project, 0)), "well outside the sphere").toBeGreaterThanOrEqual(IOU_MINIMUM);
  }, 600_000);
});
