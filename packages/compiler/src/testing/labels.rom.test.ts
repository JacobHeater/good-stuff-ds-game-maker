import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { cubeProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_2D_PROJECT, BACKDROP_BLACK, shown, type Rgb15 } from "./sprite-reference";

/**
 * Labels in real ROMs (requirements/scene-designer/STORY.labels-and-text.md): text lands in the 8 x 8 cell it should, in the color it should, on the screen it should, and a
 * script's value and text show up. Found from the pictures: the box the text's pixels fill, and their average color.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

interface Ink {
  count: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rgb: [number, number, number];
}

/** The pixels in the box that differ from the backdrop: how many, the box they fill and their average color. */
function ink(screen: Uint8Array, backdrop: Rgb15, box: { x0: number; y0: number; x1: number; y1: number }): Ink {
  const [br, bg, bb] = backdrop.map(shown);
  const found: Ink = { count: 0, x0: 999, y0: 999, x1: -1, y1: -1, rgb: [0, 0, 0] };
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) <= 24 && Math.abs(screen[i + 1] - bg) <= 24 && Math.abs(screen[i + 2] - bb) <= 24) continue;
      found.count++;
      found.x0 = Math.min(found.x0, x);
      found.x1 = Math.max(found.x1, x);
      found.y0 = Math.min(found.y0, y);
      found.y1 = Math.max(found.y1, y);
      found.rgb = [found.rgb[0] + screen[i], found.rgb[1] + screen[i + 1], found.rgb[2] + screen[i + 2]];
    }
  }
  if (found.count > 0) found.rgb = found.rgb.map((v) => Math.round(v / found.count)) as [number, number, number];
  return found;
}

function label(name: string, x: number, y: number, text: string, color: number, screen: "top" | "bottom", extra: Partial<SceneNode> = {}): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen, position: { x, y } }), label: { text, color }, ...extra };
}

describe.skipIf(!toolchain.found || !haveMelon)("labels in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-labels-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(project: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return { diagnostics: built.diagnostics, screens: captureBothScreens(rom, join(work, `${name}.png`)) };
  }

  it("in a 2D project, draws each label in its own cell and color, on both screens", async () => {
    const project = createProjectSnapshot({
      name: "Labels2D",
      mode: "2D",
      scene: createSceneNode({
        name: "Main",
        kind: "Node2D",
        children: [
          label("Red", 16, 16, "HELLO", 1, "top"), //          column 2, row 2
          label("Green", 64, 80, "WORLD", 2, "top"), //         column 8, row 10
          label("Blue", 8, 160, "BOTTOM", 4, "bottom") //        column 1, row 20, on the other screen
        ]
      })
    });
    const { diagnostics, screens } = await run(project, "two-d");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const red = ink(screens.top, BACKDROP_2D_PROJECT.top, { x0: 0, y0: 0, x1: 256, y1: 40 });
    const green = ink(screens.top, BACKDROP_2D_PROJECT.top, { x0: 0, y0: 60, x1: 256, y1: 100 });
    const blue = ink(screens.bottom, BACKDROP_2D_PROJECT.bottom, { x0: 2, y0: 140, x1: 254, y1: 188 });
    console.info(`[labels] 2D: red ${JSON.stringify(red)} green ${JSON.stringify(green)} blue ${JSON.stringify(blue)}`);
    // Five 8-pixel characters starting at (16, 16): the ink is inside that box and reaches most of it.
    expect(red.count).toBeGreaterThan(40);
    expect(red.x0).toBeGreaterThanOrEqual(16);
    expect(red.x1).toBeLessThan(16 + 5 * 8);
    expect(red.x1).toBeGreaterThan(16 + 4 * 8);
    expect(red.y0).toBeGreaterThanOrEqual(16);
    expect(red.y1).toBeLessThan(24);
    expect(red.rgb[0]).toBeGreaterThan(red.rgb[1] + 60);
    expect(green.x0).toBeGreaterThanOrEqual(64);
    expect(green.x1).toBeLessThan(64 + 5 * 8);
    expect(green.y0).toBeGreaterThanOrEqual(80);
    expect(green.y1).toBeLessThan(88);
    expect(green.rgb[1]).toBeGreaterThan(green.rgb[0] + 60);
    expect(blue.x0).toBeGreaterThanOrEqual(8);
    expect(blue.x1).toBeLessThan(8 + 6 * 8);
    expect(blue.y0).toBeGreaterThanOrEqual(160);
    expect(blue.y1).toBeLessThan(168);
    expect(blue.rgb[2]).toBeGreaterThan(blue.rgb[0] + 60);
    // The top screen has nothing where the bottom label is, and the other way round.
    expect(ink(screens.top, BACKDROP_2D_PROJECT.top, { x0: 2, y0: 140, x1: 254, y1: 188 }).count).toBe(0);
    expect(ink(screens.bottom, BACKDROP_2D_PROJECT.bottom, { x0: 2, y0: 2, x1: 254, y1: 140 }).count).toBe(0);
  }, 240_000);

  it("in a 3D project, a script sets a label's value and text, and hides a label", async () => {
    const base = cubeProject();
    const cube: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "hud" };
    const project: ProjectSnapshot = {
      ...base,
      scene: {
        ...base.scene,
        children: [
          ...base.scene.children.filter((n) => n.name !== "Cube"),
          cube,
          label("Score", 8, 8, "N{}", 3, "bottom"), //              row 1: becomes "N12345"
          label("Msg", 8, 40, "i", 6, "bottom"), //                 row 5: becomes "WWWWWWWW"
          label("Gone", 8, 88, "GONE GONE", 7, "bottom") //         row 11: hidden by the script
        ]
      },
      scripts: [
        {
          id: "hud",
          name: "Hud",
          source: 'func _ready():\n    $Score.value = 12345\n    $Msg.text = "WWWWWWWW"\n    $Gone.visible = false\n\nfunc _process(delta):\n    pass\n'
        }
      ]
    };
    const { diagnostics, screens } = await run(project, "three-d");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const score = ink(screens.bottom, BACKDROP_BLACK, { x0: 0, y0: 0, x1: 256, y1: 30 });
    const msg = ink(screens.bottom, BACKDROP_BLACK, { x0: 0, y0: 32, x1: 256, y1: 60 });
    const gone = ink(screens.bottom, BACKDROP_BLACK, { x0: 0, y0: 80, x1: 256, y1: 110 });
    console.info(`[labels] 3D: score ${JSON.stringify(score)} msg ${JSON.stringify(msg)} gone ${JSON.stringify(gone)}`);
    // "N12345" is six characters (not the three of "N{}"), starting at (8, 8).
    expect(score.x0).toBeGreaterThanOrEqual(8);
    expect(score.x1).toBeGreaterThan(8 + 5 * 8);
    expect(score.x1).toBeLessThan(8 + 6 * 8);
    expect(score.y0).toBeGreaterThanOrEqual(8);
    expect(score.y1).toBeLessThan(16);
    // "WWWWWWWW" is eight wide characters.
    expect(msg.x1).toBeGreaterThan(8 + 7 * 8 - 4);
    expect(msg.x1).toBeLessThan(8 + 8 * 8);
    expect(msg.y0).toBeGreaterThanOrEqual(40);
    expect(msg.rgb[1]).toBeGreaterThan(msg.rgb[0] + 60); // cyan: green and blue over red
    expect(msg.rgb[2]).toBeGreaterThan(msg.rgb[0] + 60);
    expect(gone.count).toBe(0);
  }, 240_000);
});
