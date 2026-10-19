import { createBlankSceneTree, createProjectSnapshot, createSpriteFromRgba, DEFAULT_INVENTORY_SLOTS, findSceneNode, getInventory, type ImportedSprite } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.inventory.md: an Inventory's own slot count, and the project's shared item list, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);

function withBag(): { state: EditorState; id: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const state = run(opened, { type: "ADD_NODE", kind: "Inventory" });
  return { state, id: state.selectedNodeId! };
}

function sheet(id = "icons"): ImportedSprite {
  const made = createSpriteFromRgba(new Uint8Array(16 * 8 * 4).fill(255), 16, 8, { name: "icons", frame: { width: 8, height: 8 } });
  if (!made.ok) throw new Error("fixture didn't convert");
  return { id, ...made.sprite };
}

describe("an Inventory node's own slot count", () => {
  it("defaults to DEFAULT_INVENTORY_SLOTS, sets a new value, clamps out of range, and undoes", () => {
    const { state, id } = withBag();
    expect(getInventory(findSceneNode(state.sceneRoot, id)!).slots).toBe(DEFAULT_INVENTORY_SLOTS);
    const resized = run(state, { type: "SET_INVENTORY", id, change: { slots: 5 } });
    expect(getInventory(findSceneNode(resized.sceneRoot, id)!).slots).toBe(5);
    expect(getInventory(findSceneNode(run(state, { type: "SET_INVENTORY", id, change: { slots: 0 } }).sceneRoot, id)!).slots).toBeGreaterThanOrEqual(1);
    expect(getInventory(findSceneNode(run(state, { type: "SET_INVENTORY", id, change: { slots: 999 } }).sceneRoot, id)!).slots).toBeLessThanOrEqual(64);
    expect(getInventory(findSceneNode(run(resized, { type: "UNDO" }).sceneRoot, id)!).slots).toBe(DEFAULT_INVENTORY_SLOTS);
  });

  it("is a no-op for a node that isn't an Inventory, and when the value doesn't change", () => {
    const { state } = withBag();
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_INVENTORY", id: other.selectedNodeId!, change: { slots: 5 } })).toBe(other);
    const resized = run(state, { type: "SET_INVENTORY", id: state.selectedNodeId!, change: { slots: DEFAULT_INVENTORY_SLOTS } });
    expect(resized).toBe(state);
  });
});

describe("an Inventory node's own on-screen panel (STORY.inventory-ui-panel.md)", () => {
  it("starts with no images and the default columns/spacing", () => {
    const { state, id } = withBag();
    const panel = getInventory(findSceneNode(state.sceneRoot, id)!);
    expect(panel.backgroundSpriteId).toBeUndefined();
    expect(panel.slotSpriteId).toBeUndefined();
    expect(panel.highlightSpriteId).toBeUndefined();
    expect(panel.columns).toBeGreaterThan(0);
  });

  it("chooses an image for each of background/slot/highlight, clears it with null, and undoes", () => {
    const { state, id } = withBag();
    const withSheet: EditorState = { ...state, project: { ...state.project!, sprites: [sheet()] } };
    const chosen = run(withSheet, { type: "SET_INVENTORY", id, change: { backgroundSpriteId: "icons" } });
    expect(getInventory(findSceneNode(chosen.sceneRoot, id)!).backgroundSpriteId).toBe("icons");
    const cleared = run(chosen, { type: "SET_INVENTORY", id, change: { backgroundSpriteId: null } });
    expect(getInventory(findSceneNode(cleared.sceneRoot, id)!).backgroundSpriteId).toBeUndefined();
    expect(getInventory(findSceneNode(run(chosen, { type: "UNDO" }).sceneRoot, id)!).backgroundSpriteId).toBeUndefined();

    const slotted = run(withSheet, { type: "SET_INVENTORY", id, change: { slotSpriteId: "icons" } });
    expect(getInventory(findSceneNode(slotted.sceneRoot, id)!).slotSpriteId).toBe("icons");
    const highlighted = run(withSheet, { type: "SET_INVENTORY", id, change: { highlightSpriteId: "icons" } });
    expect(getInventory(findSceneNode(highlighted.sceneRoot, id)!).highlightSpriteId).toBe("icons");
  });

  it("changes columns and spacing, keeping columns at most the slot count, and is a no-op when unchanged", () => {
    const { state, id } = withBag();
    const columned = run(state, { type: "SET_INVENTORY", id, change: { columns: 3 } });
    expect(getInventory(findSceneNode(columned.sceneRoot, id)!).columns).toBe(3);
    const fewSlots = run(state, { type: "SET_INVENTORY", id, change: { slots: 2, columns: 8 } });
    expect(getInventory(findSceneNode(fewSlots.sceneRoot, id)!).columns).toBe(2); // clamped to the slot count
    const spaced = run(state, { type: "SET_INVENTORY", id, change: { slotSpacingX: 4, slotSpacingY: 6 } });
    const spacedData = getInventory(findSceneNode(spaced.sceneRoot, id)!);
    expect(spacedData.slotSpacingX).toBe(4);
    expect(spacedData.slotSpacingY).toBe(6);
    expect(run(state, { type: "SET_INVENTORY", id, change: {} })).toBe(state);
  });

  it("imports a panel image, adding it to the project's sprites and setting the named field, and undoes", () => {
    const { state, id } = withBag();
    const imported = run(state, { type: "IMPORT_INVENTORY_PANEL_IMAGE", id, target: "slot", sprite: sheet(), warnings: [] });
    expect(imported.project!.sprites).toEqual([sheet()]);
    expect(getInventory(findSceneNode(imported.sceneRoot, id)!).slotSpriteId).toBe("icons");
    const undone = run(imported, { type: "UNDO" });
    expect(undone.project!.sprites ?? []).toEqual([]);
    expect(getInventory(findSceneNode(undone.sceneRoot, id)!).slotSpriteId).toBeUndefined();
  });

  it("is a no-op importing onto a node that isn't an Inventory", () => {
    const { state } = withBag();
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "IMPORT_INVENTORY_PANEL_IMAGE", id: other.selectedNodeId!, target: "background", sprite: sheet(), warnings: [] })).toBe(other);
  });
});

describe("the project's shared item list", () => {
  it("starts with none, adds one named uniquely, and undoes", () => {
    const { state } = withBag();
    expect(state.project!.items).toBeUndefined();
    const added = run(state, { type: "ADD_INVENTORY_ITEM" });
    expect(added.project!.items).toHaveLength(1);
    expect(added.project!.items![0]).toMatchObject({ name: "Item", maxStack: 99 });
    const second = run(added, { type: "ADD_INVENTORY_ITEM" });
    expect(second.project!.items!.map((i) => i.name)).toEqual(["Item", "Item2"]);
    expect(run(second, { type: "UNDO" }).project!.items!.map((i) => i.name)).toEqual(["Item"]);
  });

  it("changes a name, icon frame and max stack, one at a time, clamping and ignoring a no-op", () => {
    const { state } = withBag();
    const added = run(state, { type: "ADD_INVENTORY_ITEM" });
    const itemId = added.project!.items![0].id;
    const renamed = run(added, { type: "SET_INVENTORY_ITEM", itemId, change: { name: "Sword" }, at: 1 });
    expect(renamed.project!.items![0].name).toBe("Sword");
    const iconed = run(renamed, { type: "SET_INVENTORY_ITEM", itemId, change: { iconFrame: 3 }, at: 2 });
    expect(iconed.project!.items![0].iconFrame).toBe(3);
    const stacked = run(iconed, { type: "SET_INVENTORY_ITEM", itemId, change: { maxStack: 5000 }, at: 3 });
    expect(stacked.project!.items![0].maxStack).toBe(999); // clamped
    expect(run(stacked, { type: "SET_INVENTORY_ITEM", itemId, change: { maxStack: 999 }, at: 4 })).toBe(stacked);
    expect(run(stacked, { type: "SET_INVENTORY_ITEM", itemId, change: { name: "  " }, at: 5 })).toBe(stacked); // empty name refused
  });

  it("removes an item, clearing the whole items field once none are left, and undoes", () => {
    const { state } = withBag();
    const withTwo = run(state, { type: "ADD_INVENTORY_ITEM" }, { type: "ADD_INVENTORY_ITEM" });
    const [first, second] = withTwo.project!.items!;
    const withOne = run(withTwo, { type: "REMOVE_INVENTORY_ITEM", itemId: first.id });
    expect(withOne.project!.items!.map((i) => i.id)).toEqual([second.id]);
    const withNone = run(withOne, { type: "REMOVE_INVENTORY_ITEM", itemId: second.id });
    expect(withNone.project!.items).toBeUndefined();
    expect(run(withNone, { type: "UNDO" }).project!.items!.map((i) => i.id)).toEqual([second.id]);
  });

  it("is a no-op removing an item that doesn't exist", () => {
    const { state } = withBag();
    expect(run(state, { type: "REMOVE_INVENTORY_ITEM", itemId: "ghost" })).toBe(state);
  });
});

describe("the project's item icon sheet", () => {
  it("chooses an existing sprite, clears it, and undoes", () => {
    const { state } = withBag();
    const withSheet: EditorState = { ...state, project: { ...state.project!, sprites: [sheet()] } };
    const chosen = run(withSheet, { type: "SET_ITEM_ICON_SHEET", spriteId: "icons" });
    expect(chosen.project!.itemIconsSpriteId).toBe("icons");
    const cleared = run(chosen, { type: "SET_ITEM_ICON_SHEET", spriteId: null });
    expect(cleared.project!.itemIconsSpriteId).toBeUndefined();
    expect(run(chosen, { type: "UNDO" }).project!.itemIconsSpriteId).toBeUndefined();
  });

  it("is a no-op when the choice doesn't change", () => {
    const { state } = withBag();
    expect(run(state, { type: "SET_ITEM_ICON_SHEET", spriteId: null })).toBe(state);
  });

  it("imports a new sheet, adding it to the project's sprites and setting it as the icon sheet, and undoes", () => {
    const { state } = withBag();
    const imported = run(state, { type: "IMPORT_ITEM_ICON_SHEET", sprite: sheet(), warnings: [] });
    expect(imported.project!.sprites).toEqual([sheet()]);
    expect(imported.project!.itemIconsSpriteId).toBe("icons");
    const undone = run(imported, { type: "UNDO" });
    expect(undone.project!.sprites ?? []).toEqual([]);
    expect(undone.project!.itemIconsSpriteId).toBeUndefined();
  });
});
