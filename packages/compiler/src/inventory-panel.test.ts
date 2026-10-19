import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type InventoryData, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { hasErrors } from "./diagnostics";
import { NO_INVENTORY_PANEL, translateScene2D } from "./translate-scene-2d";

function image(id: string, width: number, height: number, color: [number, number, number] = [200, 50, 50]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

function sprite(name: string, spriteId: string, x: number, y: number): SceneNode {
  const node = createSceneNode({ name, kind: "Sprite2D", screen: "top", position: { x, y } });
  node.spriteId = spriteId;
  return node;
}

/** An Inventory node a script reaches (the same "nothing reaches it, nothing is built" rule every other test file's own `scriptedProject2D` relies on), so its panel actually compiles. */
function inventoryNode(name: string, data: Partial<InventoryData>): SceneNode {
  const node = createSceneNode({ name, kind: "Inventory", screen: "top" });
  node.inventory = data;
  node.scriptId = "s";
  return node;
}

function project2D(children: SceneNode[], sprites: ImportedSprite[] = [], itemIconsSpriteId?: string): ProjectSnapshot {
  return {
    ...createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) }),
    sprites,
    itemIconsSpriteId,
    scripts: [{ id: "s", name: "S", source: "func _process(delta):\n    pass\n" }]
  };
}

describe("an Inventory's own on-screen panel shares the exact same sprite/label tables as ordinary nodes (STORY.inventory-ui-panel.md)", () => {
  it("folds a panel's sprites and labels into the same per-screen arrays as an ordinary Sprite2D, in correctly reversed hardware order", () => {
    const bag = inventoryNode("Bag", { slots: 2, columns: 2, backgroundSpriteId: "bg", slotSpriteId: "slot", highlightSpriteId: "hi" });
    bag.position = { x: 0, y: 0 };
    const ordinary = sprite("Ordinary", "ord", 50, 50);
    const { scene, diagnostics } = translateScene2D(project2D([bag, ordinary], [image("bg", 8, 8), image("slot", 8, 8), image("icon", 8, 8), image("hi", 8, 8), image("ord", 8, 8)], "icon"));
    expect(diagnostics).toEqual([]);

    // Distinct images are deduped and kept in first-use order (images are never reversed, only sprites are) --
    // highlight before icon, since the highlight is now pushed before the icons (see below).
    expect(scene!.top.images.map((i) => i.key)).toEqual(["sprite:bg", "sprite:slot", "sprite:hi", "sprite:icon", "sprite:ord"]);

    // Raw (collection) order is background, slot 0, slot 1, highlight, icon 0, icon 1, then the ordinary sprite --
    // the highlight before the icons, not after, so an item's own icon is never hidden underneath it on a selected,
    // filled slot. The hardware list is that reversed (lowest-numbered sprite drawn on top, matching "later in
    // tree = on top").
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["Ordinary", "Bag icon 1", "Bag icon 0", "Bag highlight", "Bag slot 1", "Bag slot 0", "Bag background"]);

    expect(scene!.top.labels.map((l) => l.name)).toEqual(["Bag count 0", "Bag count 1"]);

    const inv = scene!.inventories[0];
    expect(inv.columns).toBe(2);
    expect(inv.slotWidth).toBe(8);
    expect(inv.slotHeight).toBe(8);
    expect(inv.panelX).toBe(0);
    expect(inv.panelY).toBe(0);
    // Each *Start field is slot 0's own final index; slot n is found as *Start - n, not + n (reversal flips the run).
    expect(inv.backgroundSprite).toBe(6);
    expect(inv.slotSpriteStart).toBe(5);
    expect(inv.highlightSprite).toBe(3);
    expect(inv.iconSpriteStart).toBe(2);
    expect(inv.labelStart).toBe(0);
  });

  it("errors when a panel pushes a screen's sprite count over the hardware's 128-sprite limit", () => {
    const many = Array.from({ length: 128 }, (_, i) => sprite(`S${i}`, "s", 100, 100));
    const bag = inventoryNode("Bag", { slots: 1, backgroundSpriteId: "bg" });
    const { diagnostics } = translateScene2D(project2D([...many, bag], [image("s", 8, 8), image("bg", 8, 8)]));
    expect(diagnostics.map((d) => d.code)).toContain("too-many-sprites");
  });

  it("stays under the sprite limit with no panel configured at all (the same 128 ordinary sprites alone)", () => {
    const many = Array.from({ length: 128 }, (_, i) => sprite(`S${i}`, "s", 100, 100));
    const { diagnostics } = translateScene2D(project2D(many, [image("s", 8, 8)]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("errors when a panel's own image pushes a screen's palette count over the hardware's 16-palette limit", () => {
    const images = Array.from({ length: 16 }, (_, i) => image(`s${i}`, 8, 8, [i * 10, 0, 0]));
    const sprites = images.map((img, i) => sprite(`S${i}`, img.id, 100, 100));
    const bag = inventoryNode("Bag", { slots: 1, backgroundSpriteId: "bg" });
    const { diagnostics } = translateScene2D(project2D([...sprites, bag], [...images, image("bg", 8, 8, [0, 200, 0])]));
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["too-many-sprite-palettes"]);
  });

  it("errors when a panel's own per-slot count labels push a screen over the 32-label limit", () => {
    const bag = inventoryNode("Bag", { slots: 33, backgroundSpriteId: "bg" });
    const { diagnostics } = translateScene2D(project2D([bag], [image("bg", 8, 8)]));
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["too-many-labels"]);
  });

  it("errors on a dangling panel image id, the same missing-sprite error an ordinary Sprite2D gets", () => {
    const bag = inventoryNode("Bag", { slots: 1, backgroundSpriteId: "ghost" });
    const { scene, diagnostics } = translateScene2D(project2D([bag]));
    expect(scene).toBeNull();
    expect(hasErrors(diagnostics)).toBe(true);
    const problem = diagnostics.find((d) => d.code === "missing-sprite")!;
    expect(problem.severity).toBe("error");
    expect(problem.message).toMatch(/background image uses "ghost"/);
  });

  it("draws a panel with no icon sheet at all (background/slot-frame/highlight and labels still compile; just no icon sprites)", () => {
    const bag = inventoryNode("Bag", { slots: 2, backgroundSpriteId: "bg", slotSpriteId: "slot", highlightSpriteId: "hi" });
    const { scene, diagnostics } = translateScene2D(project2D([bag], [image("bg", 8, 8), image("slot", 8, 8), image("hi", 8, 8)]));
    expect(diagnostics).toEqual([]);
    const inv = scene!.inventories[0];
    expect(inv.backgroundSprite).toBeGreaterThanOrEqual(0);
    expect(inv.slotSpriteStart).toBeGreaterThanOrEqual(0);
    expect(inv.highlightSprite).toBeGreaterThanOrEqual(0);
    expect(inv.iconSpriteStart).toBe(-1);
    expect(scene!.top.labels).toHaveLength(2);
  });

  it("draws item icons even when only the highlight image (not background or slot) is what makes the panel exist", () => {
    const bag = inventoryNode("Bag", { slots: 2, highlightSpriteId: "hi" });
    const { scene, diagnostics } = translateScene2D(project2D([bag], [image("hi", 8, 8), image("icon", 8, 8)], "icon"));
    expect(diagnostics).toEqual([]);
    const inv = scene!.inventories[0];
    expect(inv.backgroundSprite).toBe(-1);
    expect(inv.slotSpriteStart).toBe(-1);
    expect(inv.highlightSprite).toBeGreaterThanOrEqual(0);
    expect(inv.iconSpriteStart).toBeGreaterThanOrEqual(0);
  });

  it("compiles no panel at all when none of background/slot/highlight is set, even with a project-wide icon sheet and a script reaching the node", () => {
    const bag = inventoryNode("Bag", { slots: 5 });
    const { scene, diagnostics } = translateScene2D(project2D([bag], [image("icon", 8, 8)], "icon"));
    expect(diagnostics).toEqual([]);
    expect(scene!.inventories).toEqual([{ node: 0, slots: 5, ...NO_INVENTORY_PANEL }]);
    expect(scene!.top.sprites).toEqual([]);
    expect(scene!.top.labels).toEqual([]);
  });
});
