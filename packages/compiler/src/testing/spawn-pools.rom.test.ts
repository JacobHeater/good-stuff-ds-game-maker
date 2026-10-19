import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, DEFAULT_START_SCENE_ID, withSceneEntries, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { captureRomWithInput, type InputCapture } from "./emulator-capture";
import { DS_HEIGHT, DS_WIDTH } from "./reference-render";
import { BACKDROP_2D_PROJECT, shown } from "./sprite-reference";

/**
 * A spawn pool's own runtime mechanics (requirements/scene-designer/STORY.spawn-pools.md), checked on real
 * hardware: a script's `spawn("name", x, y)` actually shows a hidden copy at the given position, `despawn(handle)`
 * actually hides it again and frees its own slot for reuse, and a pool with every copy already spawned actually
 * returns -1 rather than silently corrupting another slot -- the sky box's own shipped-with-only-a-manual-check
 * bug is exactly why this gets a permanent hardware test instead of trusting the compiler-level unit tests alone.
 *
 * This checks the 2D runtime tree specifically: unlike 3D (whose world-transform cascade from a dynamic node is
 * already hardware-proven by many other 3D stories' own tests, so spawning there just has to move the right root,
 * a narrow, low-risk addition), 2D has no such cascade at all -- `gs_spawn` (2D) has to move every node of a
 * copy's own subtree itself, restoring each one's own authored position/visible from the compiled, read-only
 * node table (`gs_scene2d.nodes`), the genuinely new piece of runtime machinery this story added. That's the one
 * this test is built to catch a regression in.
 *
 * Each melonDS capture is a fresh launch (no state persists between captures), so the five snapshots below are
 * each driven by their own complete, deterministic sequence of button taps from a cold start (`is_button_pressed`,
 * edge-triggered, so each tap in a sequence fires exactly once, in order) -- not a progressively-advancing single
 * run, and not touch/click (so no need to compute screen-pixel click targets at all): "a" spawns at A, "b" spawns
 * at B, "x" attempts a third spawn (the pool only has 2 slots) tracked in a global and shown via a Label the same
 * before/after-width technique STORY.game-state-and-save.md's own hardware test already uses, "y" despawns A's
 * own copy and spawns a fourth at D.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

/** How many 8-pixel characters wide the text in the rows y0 to y1 of the given (sampled) screen is, from its left edge at x = 8, against this *2D* project's own top-screen backdrop (not black -- see inventory-ui-panel.rom.test.ts's own note on why BACKDROP_BLACK is wrong here: that one is the 3D runtime's own always-black sub-screen). */
function textWidth(screen: Uint8Array, y0: number, y1: number): number {
  const [br, bg, bb] = BACKDROP_2D_PROJECT.top.map(shown);
  let right = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 2; x < 254; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) right = Math.max(right, x);
    }
  }
  return right < 0 ? 0 : Math.floor((right - 8) / 8) + 1;
}

/** The screen a capture found (the top one, for a standalone 2D project), sampled to 256x192, three bytes a pixel. */
function topScreen(pngPath: string, capture: InputCapture): Uint8Array {
  const png = PNG.sync.read(readFileSync(pngPath));
  const { screen } = capture;
  const scale = screen.width / DS_WIDTH;
  const out = new Uint8Array(DS_WIDTH * DS_HEIGHT * 3);
  for (let y = 0; y < DS_HEIGHT; y++) {
    for (let x = 0; x < DS_WIDTH; x++) {
      const sx = Math.min(png.width - 1, Math.floor(screen.left + (x + 0.5) * scale));
      const sy = Math.min(png.height - 1, Math.floor(screen.top + (y + 0.5) * scale));
      const i = (sy * png.width + sx) * 4;
      out.set([png.data[i], png.data[i + 1], png.data[i + 2]], (y * DS_WIDTH + x) * 3);
    }
  }
  return out;
}

function pixelAt(screen: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * DS_WIDTH + x) * 3;
  return [screen[i], screen[i + 1], screen[i + 2]];
}

function near(sample: readonly [number, number, number], expected: readonly [number, number, number], tolerance = 40): boolean {
  return Math.abs(sample[0] - expected[0]) <= tolerance && Math.abs(sample[1] - expected[1]) <= tolerance && Math.abs(sample[2] - expected[2]) <= tolerance;
}

function label(name: string, y: number, text: string): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "top", position: { x: 8, y } }), label: { text, color: 7 } };
}

function solidSprite(id: string, width: number, height: number, color: readonly [number, number, number]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

const ORANGE: [number, number, number] = [230, 140, 20];

// Four candidate points, well apart, none overlapping the "HandleC" label's own row (y 0-8).
const A: [number, number] = [40, 48];
const B: [number, number] = [88, 48];
const C: [number, number] = [136, 48];
const D: [number, number] = [184, 48];

describe.skipIf(!toolchain.found || !haveMelon)("a spawn pool in a real 2D ROM (STORY.spawn-pools.md)", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-spawn-pools-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder2D = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime2d") });

  const campfire: SceneNode = { ...createSceneNode({ name: "CampfireBody", kind: "Sprite2D", screen: "top", position: { x: 0, y: 0 } }), spriteId: "campfire" };
  const pool: SceneNode = { ...createSceneNode({ name: "Campfires", kind: "Node2D", screen: "top", position: { x: 0, y: 0 } }), instanceOf: "campfire", spawnPoolCount: 2 };
  const script: SceneNode = { ...createSceneNode({ name: "Script", kind: "Node2D", screen: "top" }), scriptId: "s" };
  const level = createSceneNode({ name: "Main", kind: "Node2D", children: [pool, script, label("HandleC", 0, "H{}")] });
  const project: ProjectSnapshot = {
    ...withSceneEntries(createProjectSnapshot({ name: "Pool", mode: "2D", scene: level }), [
      { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
      { id: "campfire", name: "Campfire", scene: campfire, isStart: false }
    ]),
    sprites: [solidSprite("campfire", 16, 16, ORANGE)],
    scripts: [
      {
        id: "s",
        name: "S",
        source: [
          "global var handleA = -2",
          "global var handleC = -2",
          "func _process(delta):",
          '    if Input.is_button_pressed("a"):',
          `        handleA = spawn("Campfires", ${A[0]}.0, ${A[1]}.0)`,
          '    if Input.is_button_pressed("b"):',
          `        var h = spawn("Campfires", ${B[0]}.0, ${B[1]}.0)`,
          '    if Input.is_button_pressed("x"):',
          `        handleC = spawn("Campfires", ${C[0]}.0, ${C[1]}.0)`,
          '    if Input.is_button_pressed("y"):',
          "        despawn(handleA)",
          `        handleA = spawn("Campfires", ${D[0]}.0, ${D[1]}.0)`,
          // +11 so idle's -2 (-> 9, one digit) and the exhausted pool's -1 (-> 10, two digits) render at different
          // widths -- -1 and -2 both as text ("H-1"/"H-2") would be the same width, unable to tell "really -1" from
          // "never updated, still -2" (a bug this check would otherwise not catch).
          "    $HandleC.value = handleC + 11",
          ""
        ].join("\n")
      }
    ]
  };

  const rom = join(work, "spawn-pools.nds");
  beforeAll(async () => {
    const built = await compileProject(project, rom, builder2D);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    if (built.diagnostics.some((d) => d.severity === "error")) throw new Error(`Unexpected error diagnostics: ${JSON.stringify(built.diagnostics)}`);
  }, 60_000);

  it("idle: nothing is spawned, and handleC's own default (-2, x never pressed) shows", async () => {
    const png = join(work, "idle.png");
    const capture = captureRomWithInput(rom, png, { holdSeconds: 1 });
    const screen = topScreen(png, capture);
    const atA = pixelAt(screen, ...A);
    const handleC = textWidth(screen, 0, 8); // "H9" (handleC=-2, +11 = 9) = 2
    console.info(`[spawn-pools] idle: atA=${JSON.stringify(atA)} handleC=${handleC}`);
    expect(near(atA, ORANGE)).toBe(false);
    expect(near(pixelAt(screen, ...B), ORANGE)).toBe(false);
    expect(handleC).toBe(2);
  }, 60_000);

  it("tapping a: the first copy spawns at A, nowhere else", async () => {
    const png = join(work, "tap-a.png");
    const capture = captureRomWithInput(rom, png, { tap: ["a"], holdSeconds: 1 });
    const screen = topScreen(png, capture);
    expect(near(pixelAt(screen, ...A), ORANGE)).toBe(true);
    expect(near(pixelAt(screen, ...B), ORANGE)).toBe(false);
    expect(near(pixelAt(screen, ...C), ORANGE)).toBe(false);
    expect(near(pixelAt(screen, ...D), ORANGE)).toBe(false);
  }, 60_000);

  it("tapping a then b: both copies show, at A and B", async () => {
    const png = join(work, "tap-ab.png");
    const capture = captureRomWithInput(rom, png, { tap: ["a", "b"], holdSeconds: 1 });
    const screen = topScreen(png, capture);
    expect(near(pixelAt(screen, ...A), ORANGE)).toBe(true);
    expect(near(pixelAt(screen, ...B), ORANGE)).toBe(true);
    expect(near(pixelAt(screen, ...C), ORANGE)).toBe(false);
  }, 60_000);

  it("tapping a, b, then x: the pool is exhausted -- the third spawn draws nothing at C, and returns -1", async () => {
    const png = join(work, "tap-abx.png");
    const capture = captureRomWithInput(rom, png, { tap: ["a", "b", "x"], holdSeconds: 1 });
    const screen = topScreen(png, capture);
    const handleC = textWidth(screen, 0, 8); // "H10" (handleC=-1, +11 = 10) = 3
    console.info(`[spawn-pools] exhausted: handleC=${handleC}`);
    expect(near(pixelAt(screen, ...A), ORANGE)).toBe(true); // unaffected
    expect(near(pixelAt(screen, ...B), ORANGE)).toBe(true); // unaffected
    expect(near(pixelAt(screen, ...C), ORANGE)).toBe(false); // the failed third spawn drew nothing
    expect(handleC).toBe(3); // "H10", one wider than idle's "H9" -- really -1, not still -2
  }, 60_000);

  it("tapping a, b, then y: despawning A's own copy frees its slot, which a fourth spawn at D then reuses", async () => {
    const png = join(work, "tap-aby.png");
    const capture = captureRomWithInput(rom, png, { tap: ["a", "b", "y"], holdSeconds: 1 });
    const screen = topScreen(png, capture);
    expect(near(pixelAt(screen, ...A), ORANGE)).toBe(false); // despawned
    expect(near(pixelAt(screen, ...B), ORANGE)).toBe(true); // untouched
    expect(near(pixelAt(screen, ...D), ORANGE)).toBe(true); // the freed slot, reused
  }, 60_000);
});
