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
import { cubeProject } from "../fixtures";
import { captureBothScreens, captureRomWithInput } from "./emulator-capture";
import { BACKDROP_BLACK, shown } from "./sprite-reference";

/**
 * An Inventory's add()/remove()/count()/slot_count()/slot_item_is()/slot_icon() (requirements/scene-designer/STORY.inventory.md),
 * checked on real hardware, not just unit-tested TypeScript: this story's own stacking/leftover arithmetic and its slot lookups
 * run in generated C on a real ARM9, and the DS depth/translucency surprises this project has already hit once (the sky box's
 * own shipped-with-only-a-manual-check bug) are exactly why every risky runtime addition since gets a permanent hardware test
 * instead. The numbers are shown with labels on the bottom screen and read from the picture by how wide the text is (an "N{}"
 * label is one character for the N and one for each digit), the same technique STORY.game-state-and-save.md's own hardware test
 * already uses.
 *
 * A second test confirms gs_sprite_set_frame actually changes which graphic an OAM sprite shows, the same before/after capture
 * technique sky-box-cycle.rom.test.ts already uses for a script-driven visibility toggle.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

/** How many 8-pixel characters wide the text in the rows y0 to y1 of the bottom screen is, from its left edge at x = 8. Identical to game-state.rom.test.ts's own copy. */
function textWidth(screen: Uint8Array, y0: number, y1: number): number {
  const [br, bg, bb] = BACKDROP_BLACK.map(shown);
  let right = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 2; x < 254; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) right = Math.max(right, x);
    }
  }
  return right < 0 ? 0 : Math.floor((right - 8) / 8) + 1;
}

function label(name: string, y: number, text: string): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "bottom", position: { x: 8, y } }), label: { text, color: 7 } };
}

describe.skipIf(!toolchain.found || !haveMelon)("an Inventory in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-inventory-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder3D = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });
  const builder2D = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime2d") });

  it("adds across slots respecting max stack, caps remove() at what's there, and reads slots back correctly", async () => {
    const base = cubeProject();
    const cube: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "probe" };
    const bag = createSceneNode({ name: "Bag", kind: "Inventory" });
    bag.inventory = { slots: 2 };
    const project: ProjectSnapshot = {
      ...base,
      scene: {
        ...base.scene,
        children: [
          ...base.scene.children.filter((n) => n.name !== "Cube"),
          cube,
          bag,
          label("Leftover", 8, "N{}"), //    row 1: the leftover from a bag that fills up mid-add (expect 15)
          label("SlotTwo", 24, "N{}"), //    row 3: slot 1's own count once the first two adds overflow into it, before the third add fills it the rest of the way (expect 5)
          label("Removed", 40, "N{}"), //    row 5: how many remove() actually took, capped at what's there (expect 20)
          label("After", 56, "N{}"), //      row 7: count() once the bag is empty again (expect 0)
          label("Icon", 72, "N{}"), //       row 9: slot_icon() of the item's own iconFrame (expect 3)
          label("IsGem", 88, "?") //         row 11: slot_item_is(0, "Gem") while slot 0 still holds it (expect "YES")
        ]
      },
      items: [{ id: crypto.randomUUID(), name: "Gem", iconFrame: 3, maxStack: 10 }],
      scripts: [
        {
          id: "probe",
          name: "Probe",
          source: [
            "func _ready():",
            '    var l1 = $Bag.add("Gem", 7)',
            '    var l2 = $Bag.add("Gem", 8)',
            "    var slotTwo = $Bag.slot_count(1)",
            '    var l3 = $Bag.add("Gem", 20)',
            '    var isGem = $Bag.slot_item_is(0, "Gem")',
            "    var icon = $Bag.slot_icon(1)",
            '    var removed = $Bag.remove("Gem", 25)',
            '    var afterCount = $Bag.count("Gem")',
            "    $Leftover.value = l3",
            "    $SlotTwo.value = slotTwo",
            "    $Removed.value = removed",
            "    $After.value = afterCount",
            "    $Icon.value = icon",
            "    if isGem:",
            '        $IsGem.text = "YES"',
            "    else:",
            '        $IsGem.text = "NO"',
            ""
          ].join("\n")
        }
      ]
    };
    const rom = join(work, "inventory.nds");
    const built = await compileProject(project, rom, builder3D);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const screens = captureBothScreens(rom, join(work, "inventory.png"));
    const leftover = textWidth(screens.bottom, 8, 16); // "N15" = 3
    const slotTwo = textWidth(screens.bottom, 24, 32); // "N5" = 2
    const removed = textWidth(screens.bottom, 40, 48); // "N20" = 3
    const after = textWidth(screens.bottom, 56, 64); // "N0" = 2
    const icon = textWidth(screens.bottom, 72, 80); // "N3" = 2
    const isGem = textWidth(screens.bottom, 88, 96); // "YES" = 3, "NO" = 2
    console.info(`[inventory] leftover=${leftover} slotTwo=${slotTwo} removed=${removed} after=${after} icon=${icon} isGem=${isGem}`);
    expect(leftover).toBe(3);
    expect(slotTwo).toBe(2);
    expect(removed).toBe(3);
    expect(after).toBe(2);
    expect(icon).toBe(2);
    expect(isGem).toBe(3);
  }, 240_000);

  it("gs_sprite_set_frame actually shows a different frame of the sheet once a script picks it", async () => {
    // Two 16x16 frames of one sheet: frame 0 solid red, frame 1 solid blue -- exactly what slot_icon() would hand a
    // real game (an item's own icon frame) to show with set_frame(), just without an Inventory in the way of the test.
    const rgba = new Uint8Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const frame1 = x >= 16;
        rgba.set(frame1 ? [0, 0, 255, 255] : [255, 0, 0, 255], i);
      }
    }
    const made = createSpriteFromRgba(rgba, 32, 16, { name: "sheet", frame: { width: 16, height: 16 } });
    if (!made.ok) throw new Error(made.errors.join(" "));
    const sheet: ImportedSprite = { id: "sheet", ...made.sprite };

    const sprite = createSceneNode({ name: "Hero", kind: "Sprite2D", screen: "top", position: { x: 128, y: 96 } });
    sprite.spriteId = "sheet";
    sprite.scriptId = "setframe";
    const project: ProjectSnapshot = {
      ...createProjectSnapshot({ name: "SetFrame", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [sprite] }) }),
      sprites: [sheet],
      scripts: [{ id: "setframe", name: "SetFrame", source: 'func _process(delta):\n    if Input.is_button_down("a"):\n        $Hero.set_frame(1)\n' }]
    };
    const rom = join(work, "setframe.nds");
    const built = await compileProject(project, rom, builder2D);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const sampleScreenCenter = (pngPath: string, capture: { screen: { left: number; top: number; width: number; height: number } }) => {
      const png = PNG.sync.read(readFileSync(pngPath));
      const cx = Math.round(capture.screen.left + capture.screen.width / 2);
      const cy = Math.round(capture.screen.top + capture.screen.height / 2);
      const i = (cy * png.width + cx) * 4;
      return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
    };

    const idlePng = join(work, "setframe-idle.png");
    const idle = captureRomWithInput(rom, idlePng, { holdSeconds: 1 });
    const idleColor = sampleScreenCenter(idlePng, idle);
    console.info(`[set_frame] idle (frame 0, red): ${JSON.stringify(idleColor)}`);
    expect(idleColor.r).toBeGreaterThan(idleColor.b);

    const heldPng = join(work, "setframe-held.png");
    const held = captureRomWithInput(rom, heldPng, { hold: ["a"], holdSeconds: 1 });
    const heldColor = sampleScreenCenter(heldPng, held);
    console.info(`[set_frame] held "a" (frame 1, blue): ${JSON.stringify(heldColor)}`);
    expect(heldColor.b).toBeGreaterThan(heldColor.r);
  }, 240_000);
});
