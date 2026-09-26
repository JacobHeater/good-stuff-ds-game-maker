import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, createSpriteFromRgba, DEFAULT_START_SCENE_ID, withSceneEntries, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { cubeProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_BLACK, covered, drawReference, matchRatio } from "./sprite-reference";

/**
 * Several scenes in a real ROM (requirements/scene-designer/STORY.multiple-scenes.md): a 3D project of three scenes, each showing a sprite of its own on the 2D screen. The first scene's
 * script waits ten frames and calls change_scene("Second"), the second's does the same for "Third", and the third has no script. After the emulator has run for a while only the third
 * scene's sprite may be on the screen: the switches were made, the sprites and sprite memory of the scenes left behind are gone, and the new scenes' sprites are drawn.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

function flat(id: string, color: [number, number, number], size = 32): ImportedSprite {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, size, size, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

const NEXT = (name: string): string => `var frames = 0\nfunc _process(delta):\n    frames += 1\n    if frames == 10:\n        change_scene("${name}")\n`;

/** The cube fixture's scene (camera, light, cube) plus one sprite on the 2D screen; `source` becomes a script on the cube. */
function scene(name: string, sprite: { image: string; x: number; y: number }, source?: string): SceneNode {
  const base = cubeProject().scene;
  const drawn: SceneNode = { ...createSceneNode({ name: `${name}Sprite`, kind: "Sprite2D", screen: "bottom", position: { x: sprite.x, y: sprite.y } }), spriteId: sprite.image };
  return { ...base, name, children: [...base.children.map((n) => (n.name === "Cube" && source ? { ...n, scriptId: `script-${name}` } : n)), drawn] };
}

function threeScenes(): ProjectSnapshot {
  const base = cubeProject();
  const first = scene("First", { image: "red", x: 60, y: 60 }, NEXT("Second"));
  const project = withSceneEntries(
    { ...base, sprites: [flat("red", [248, 0, 0]), flat("green", [0, 248, 0], 16), flat("blue", [0, 0, 248])] },
    [
      { id: DEFAULT_START_SCENE_ID, name: "First", scene: first, isStart: true },
      { id: "second", name: "Second", scene: scene("Second", { image: "green", x: 128, y: 96 }, NEXT("Third")), isStart: false },
      { id: "third", name: "Third", scene: scene("Third", { image: "blue", x: 200, y: 140 }), isStart: false }
    ]
  );
  return {
    ...project,
    scripts: [
      { id: "script-First", name: "First", source: NEXT("Second") },
      { id: "script-Second", name: "Second", source: NEXT("Third") }
    ]
  };
}

describe.skipIf(!toolchain.found || !haveMelon)("several scenes in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-scenes-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  it("a script switches scene twice, and only the last scene's sprite is left on the screen", async () => {
    const project = threeScenes();
    const rom = join(work, "scenes.nds");
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const screens = captureBothScreens(rom, join(work, "scenes.png"));
    // What the screen should show: the third scene's sprite alone (blue, 32 x 32 at 200, 140), on the black backdrop of a 3D project's 2D screen.
    const third = { ...project, scene: project.scenes![1].scene };
    const expected = drawReference(third, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK });
    const bottom = matchRatio(screens.bottom, expected.bottom);
    console.info(`[scenes] 2D screen after two switches: match ${bottom.toFixed(4)}; ${covered(screens.bottom, BACKDROP_BLACK)} sprite pixels`);
    expect(covered(expected.bottom, BACKDROP_BLACK)).toBe(32 * 32);
    expect(covered(screens.bottom, BACKDROP_BLACK)).toBeGreaterThan(32 * 32 - 100);
    expect(covered(screens.bottom, BACKDROP_BLACK)).toBeLessThan(32 * 32 + 100); // nothing of the red or green sprites is left
    expect(bottom).toBeGreaterThanOrEqual(0.995);
    // Not vacuous: had it stayed in the first scene the screen would show the red sprite instead.
    const first = drawReference({ ...project }, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK });
    expect(matchRatio(screens.bottom, first.bottom)).toBeLessThan(0.99); // two 32 x 32 sprites differ by about 4% of the screen
  }, 240_000);
});
