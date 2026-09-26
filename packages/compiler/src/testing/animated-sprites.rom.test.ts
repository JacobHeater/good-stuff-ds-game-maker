import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { cubeWithSpritesProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_2D_PROJECT, BACKDROP_BLACK, covered, drawReference, matchRatio } from "./sprite-reference";

/**
 * Animated sprites in real ROMs (requirements/scene-designer/STORY.animated-sprites.md): a sprite sheet of four flat-colored frames (red, green, blue, yellow), sprites that
 * show different frames, and an animation that has to move on by itself to get where the picture says it ends up. Both screens are compared pixel by pixel with a reference
 * drawn from the sheet (`drawReference`, told which frame each sprite should be on by the time of the capture).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

/** Four 32 x 32 frames in a row, each one color: frame 0 red, 1 green, 2 blue, 3 yellow. */
function colorSheet(): ImportedSprite {
  const colors: Array<[number, number, number]> = [[248, 0, 0], [0, 248, 0], [0, 0, 248], [248, 248, 0]];
  const rgba = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 128; x++) rgba.set([...colors[Math.floor(x / 32)], 255], (y * 128 + x) * 4);
  }
  const made = createSpriteFromRgba(rgba, 128, 32, { name: "colors", frame: { width: 32, height: 32 } });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id: "colors", ...made.sprite };
}

function animated(name: string, x: number, y: number, animations: Array<{ name: string; frames: number[]; fps: number; loop: boolean }>, start: string | undefined, screen: "top" | "bottom", extra: Partial<SceneNode> = {}): SceneNode {
  return { ...createSceneNode({ name, kind: "AnimatedSprite2D", screen, position: { x, y } }), spriteId: "colors", spriteAnimations: { animations, ...(start ? { start } : {}) }, ...extra };
}

describe.skipIf(!toolchain.found || !haveMelon)("animated sprites in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-animated-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(project: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return { diagnostics: built.diagnostics, screens: captureBothScreens(rom, join(work, `${name}.png`)) };
  }

  it("in a 2D project, shows the frame each sprite starts on and moves an animation on by itself to its last frame", async () => {
    const project: ProjectSnapshot = {
      ...createProjectSnapshot({
        name: "Anim2D",
        mode: "2D",
        scene: createSceneNode({
          name: "Main",
          kind: "Node2D",
          children: [
            animated("Idle", 40, 50, [{ name: "hold", frames: [1], fps: 8, loop: false }], undefined, "top"), //             no animation starts: frame 0 (red)
            animated("Still", 100, 50, [{ name: "hold", frames: [2], fps: 8, loop: false }], "hold", "top"), //             starts on frame 2 (blue)
            animated("Once", 160, 50, [{ name: "go", frames: [1, 2, 3], fps: 60, loop: false }], "go", "top"), //          runs 1, 2, 3 and stays on 3 (yellow)
            animated("Bottom", 128, 100, [{ name: "go", frames: [0, 1], fps: 60, loop: false }], "go", "bottom") //          a second engine: ends on frame 1 (green)
          ]
        })
      }),
      sprites: [colorSheet()]
    };
    const { diagnostics, screens } = await run(project, "two-d");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const finalFrame: Record<string, number> = { Idle: 0, Still: 2, Once: 3, Bottom: 1 };
    const expected = drawReference(project, BACKDROP_2D_PROJECT, (node) => finalFrame[node.name]);
    const top = matchRatio(screens.top, expected.top);
    const bottom = matchRatio(screens.bottom, expected.bottom);
    console.info(`[animated] 2D project: top ${top.toFixed(4)}, bottom ${bottom.toFixed(4)}`);
    expect(covered(screens.top, BACKDROP_2D_PROJECT.top)).toBeGreaterThan(3 * 32 * 32 - 100);
    expect(top).toBeGreaterThanOrEqual(0.995);
    expect(bottom).toBeGreaterThanOrEqual(0.995);
    // Not vacuous: had "Once" stayed on its first frame (green), or "Idle" not been red, the picture would be different.
    const wrong = drawReference(project, BACKDROP_2D_PROJECT, (node) => ({ ...finalFrame, Once: 1 })[node.name]);
    expect(matchRatio(screens.top, wrong.top)).toBeLessThan(0.99);
  }, 240_000);

  it("in a 3D project, a script starts an animation on the 2D screen's sprite by name and it runs to its end", async () => {
    const base = cubeWithSpritesProject();
    const hero: SceneNode = {
      ...animated("Hero", 128, 96, [{ name: "idle", frames: [0], fps: 8, loop: false }, { name: "go", frames: [1, 2, 3], fps: 60, loop: false }], undefined, "bottom"),
      scriptId: "play"
    };
    const project: ProjectSnapshot = {
      ...base,
      scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "Sprite2D"), hero] },
      sprites: [...(base.sprites ?? []), colorSheet()],
      scripts: [{ id: "play", name: "Play", source: 'func _ready():\n    play("go")\n\nfunc _process(delta):\n    pass\n' }]
    };
    const { diagnostics, screens } = await run(project, "three-d");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const expected = drawReference({ ...project, scene: { ...project.scene, children: [hero] } }, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }, () => 3);
    const bottom = matchRatio(screens.bottom, expected.bottom);
    console.info(`[animated] 3D project 2D screen: match ${bottom.toFixed(4)}`);
    expect(covered(screens.bottom, BACKDROP_BLACK)).toBeGreaterThan(32 * 32 - 100);
    expect(bottom).toBeGreaterThanOrEqual(0.995);
    const stuck = drawReference({ ...project, scene: { ...project.scene, children: [hero] } }, { top: BACKDROP_BLACK, bottom: BACKDROP_BLACK }, () => 0);
    expect(matchRatio(screens.bottom, stuck.bottom)).toBeLessThan(0.99);
  }, 240_000);
});
