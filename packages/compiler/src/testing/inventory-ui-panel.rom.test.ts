import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { bottomScreenPoint, captureRomWithInput, type InputCapture } from "./emulator-capture";
import { DS_HEIGHT, DS_WIDTH } from "./reference-render";
import { BACKDROP_2D_PROJECT, shown } from "./sprite-reference";

/**
 * An Inventory's own auto-drawn on-screen panel (requirements/scene-designer/STORY.inventory-ui-panel.md), checked
 * on real hardware: the background/slot-frame/item-icon/highlight sprites this story folds into the exact same
 * per-screen OAM table an ordinary Sprite2D already shares, a real touch selecting a slot, and the panel's own
 * live visibility, all run as generated C on a real ARM9 -- the sky box's own shipped-with-only-a-manual-check
 * bug is exactly why this gets a permanent hardware test instead of trusting the compiler-level unit tests alone.
 *
 * One ROM, three captures: idle (nothing added, nothing touched), holding "a" (fills slot 0 alone) while clicking
 * slot 1's own (still empty) cell (selects it, moving the highlight there), and holding "b" (the Inventory's own
 * script sets its `visible` to false). A "Selected" label shows `selected_slot()`'s own value, read the same
 * before/after-width technique STORY.game-state-and-save.md's own hardware test already uses.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

/**
 * How many 8-pixel characters wide the text in the rows y0 to y1 of the bottom screen is, from its left edge at x = 8 -- the
 * same before/after-width technique inventory.rom.test.ts's own copy uses, but against this project's own bottom-screen
 * backdrop (BACKDROP_2D_PROJECT.bottom), not black: this is a standalone 2D project, not the 3D runtime's own always-black
 * sub-screen (BACKDROP_BLACK) that one measures against, and the console's own unprinted cells show the real backdrop
 * through, not solid black.
 */
function textWidth(screen: Uint8Array, y0: number, y1: number): number {
  const [br, bg, bb] = BACKDROP_2D_PROJECT.bottom.map(shown);
  let right = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 2; x < 254; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) right = Math.max(right, x);
    }
  }
  return right < 0 ? 0 : Math.floor((right - 8) / 8) + 1;
}

/** The bottom screen (directly below the top screen a capture found, the same size), sampled to 256x192, three bytes a pixel -- the same convention `captureBothScreens` uses. */
function bottomScreen(pngPath: string, capture: InputCapture): Uint8Array {
  const png = PNG.sync.read(readFileSync(pngPath));
  const { screen } = capture;
  const scale = screen.width / DS_WIDTH;
  const out = new Uint8Array(DS_WIDTH * DS_HEIGHT * 3);
  for (let y = 0; y < DS_HEIGHT; y++) {
    for (let x = 0; x < DS_WIDTH; x++) {
      const sx = Math.min(png.width - 1, Math.floor(screen.left + (x + 0.5) * scale));
      const sy = Math.min(png.height - 1, Math.floor(screen.top + screen.height + (y + 0.5) * scale));
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
  return { ...createSceneNode({ name, kind: "Label", screen: "bottom", position: { x: 8, y } }), label: { text, color: 7 } };
}

function solidSprite(id: string, width: number, height: number, color: readonly [number, number, number]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

/** A 2-frame sheet, each frame a solid color: frame 0 (empty) then frame 1 (filled), side by side. */
function twoFrameSprite(id: string, frameWidth: number, frameHeight: number, empty: readonly [number, number, number], filled: readonly [number, number, number]): ImportedSprite {
  const width = frameWidth * 2;
  const rgba = new Uint8Array(width * frameHeight * 4);
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < width; x++) rgba.set([...(x < frameWidth ? empty : filled), 255], (y * width + x) * 4);
  }
  const made = createSpriteFromRgba(rgba, width, frameHeight, { name: id, frame: { width: frameWidth, height: frameHeight } });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

// Distinct solid colors, one per layer, so a sampled pixel says exactly which sprite (if any) is drawn there.
const GREEN: [number, number, number] = [20, 200, 20]; // background
const GREY: [number, number, number] = [130, 130, 130]; // slot frame, empty
const YELLOW: [number, number, number] = [230, 230, 20]; // slot frame, filled
const BLUE: [number, number, number] = [20, 20, 230]; // item icon
const MAGENTA: [number, number, number] = [230, 20, 230]; // highlight

// The panel's own fixed layout: a 2x1 grid of 16x16 slots at (100, 100), no spacing, with a 64x32 background
// (one of the DS's own sprite sizes) that reaches past the grid on the right and below -- room for a
// background-only sample point.
const PANEL_X = 100;
const PANEL_Y = 100;
const CELL0: [number, number] = [PANEL_X + 8, PANEL_Y + 8]; // slot 0's own center
const CELL1: [number, number] = [PANEL_X + 24, PANEL_Y + 8]; // slot 1's own center
const BACKGROUND_ONLY: [number, number] = [PANEL_X + 48, PANEL_Y + 24]; // inside the background, outside both cells

describe.skipIf(!toolchain.found || !haveMelon)("an Inventory's own on-screen panel in a real 2D ROM (STORY.inventory-ui-panel.md)", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-inventory-panel-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder2D = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime2d") });

  it("draws its background/slot frames/highlight, swaps in an item's icon once added, selects a slot by touch, and hides when its node's own visible is set false", async () => {
    const bag = createSceneNode({ name: "Bag", kind: "Inventory", screen: "bottom", position: { x: PANEL_X, y: PANEL_Y } });
    bag.inventory = { slots: 2, columns: 2, slotSpacingX: 0, slotSpacingY: 0, backgroundSpriteId: "bg", slotSpriteId: "slot", highlightSpriteId: "hi" };
    bag.scriptId = "panel";
    const project: ProjectSnapshot = {
      ...createProjectSnapshot({ name: "Panel", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [bag, label("Selected", 0, "S{}")] }) }),
      sprites: [solidSprite("bg", 64, 32, GREEN), twoFrameSprite("slot", 16, 16, GREY, YELLOW), solidSprite("hi", 16, 16, MAGENTA), solidSprite("icon", 16, 16, BLUE)],
      itemIconsSpriteId: "icon",
      // maxStack 5 but only 1 added: fills slot 0 alone (add() fills the first that fit), leaving slot 1 empty for
      // the touch/highlight half of this test -- a slot that's both filled and selected would have its own icon
      // and the highlight drawn one fully over the other (both 16x16, both opaque, same cell), so sampling either
      // one there would say nothing a compiler-level test (inventory-panel.test.ts, which checks the icon is
      // compiled to draw over the highlight, not the other way around) doesn't already cover more directly.
      items: [{ id: "gem", name: "Gem", iconFrame: 0, maxStack: 5 }],
      scripts: [
        {
          id: "panel",
          name: "Panel",
          source: [
            "func _process(delta):",
            '    if Input.is_button_pressed("a"):', // once, not every held frame -- add("Gem", 1) repeated for ~70 frames would overflow into slot 1 too
            '        add("Gem", 1)',
            '    if Input.is_button_down("b"):',
            "        visible = false",
            "    $Selected.value = selected_slot()",
            ""
          ].join("\n")
        }
      ]
    };
    const rom = join(work, "panel.nds");
    const built = await compileProject(project, rom, builder2D);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const idlePng = join(work, "panel-idle.png");
    const idle = captureRomWithInput(rom, idlePng, { holdSeconds: 1 });
    const idleScreen = bottomScreen(idlePng, idle);
    const idleSelected = textWidth(idleScreen, 0, 8); // "S-1" = 3

    const addClickPng = join(work, "panel-add-click.png");
    const addClick = captureRomWithInput(rom, addClickPng, { hold: ["a"], click: bottomScreenPoint(idle, CELL1[0] / DS_WIDTH, CELL1[1] / DS_HEIGHT), holdSeconds: 1.2 });
    const addClickScreen = bottomScreen(addClickPng, addClick);
    const addClickSelected = textWidth(addClickScreen, 0, 8); // "S1" = 2

    const hiddenPng = join(work, "panel-hidden.png");
    const hidden = captureRomWithInput(rom, hiddenPng, { hold: ["b"], holdSeconds: 1 });
    const hiddenScreen = bottomScreen(hiddenPng, hidden);

    const idleBg = pixelAt(idleScreen, ...BACKGROUND_ONLY);
    const idleCell0 = pixelAt(idleScreen, ...CELL0);
    const idleHighlightAtCell0 = near(idleCell0, MAGENTA);
    const filledCell0 = pixelAt(addClickScreen, ...CELL0);
    const highlightedCell1 = pixelAt(addClickScreen, ...CELL1);
    const hiddenBg = pixelAt(hiddenScreen, ...BACKGROUND_ONLY);

    console.info(
      `[inventory-ui-panel] idleBg=${JSON.stringify(idleBg)} idleCell0=${JSON.stringify(idleCell0)} idleSelected=${idleSelected} ` +
        `filledCell0=${JSON.stringify(filledCell0)} highlightedCell1=${JSON.stringify(highlightedCell1)} addClickSelected=${addClickSelected} hiddenBg=${JSON.stringify(hiddenBg)}`
    );

    // Idle: the background shows where nothing else covers it, each slot is empty (grey, no icon), no slot is selected, and no highlight shows.
    expect(near(idleBg, GREEN)).toBe(true);
    expect(near(idleCell0, GREY)).toBe(true);
    expect(idleSelected).toBe(3); // "S-1"
    expect(idleHighlightAtCell0).toBe(false);

    // Holding "a" (add("Gem", 1), filling slot 0 alone) and clicking slot 1's own (still empty) cell: an item's icon
    // swapped in at slot 0, untouched by the touch; the highlight moved onto slot 1 and shows clearly there (nothing
    // else drawn over it, since the slot is empty); selected_slot() -- read off the "Selected" label -- reports 1.
    expect(near(filledCell0, BLUE)).toBe(true);
    expect(near(highlightedCell1, MAGENTA)).toBe(true);
    expect(addClickSelected).toBe(2);

    // Holding "b" (the Inventory's own script sets its visible to false): the whole panel, background included, disappears.
    expect(near(hiddenBg, GREEN)).toBe(false);
  }, 300_000);
});
