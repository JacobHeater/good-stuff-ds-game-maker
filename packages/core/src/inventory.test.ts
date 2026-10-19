import { describe, expect, it } from "vitest";

import {
  clampMaxStack,
  DEFAULT_INVENTORY,
  getInventory,
  INVENTORY_COLUMNS_MAX,
  INVENTORY_COLUMNS_MIN,
  INVENTORY_MAX_STACK_MAX,
  INVENTORY_MAX_STACK_MIN,
  INVENTORY_SLOT_SPACING_MAX,
  INVENTORY_SLOT_SPACING_MIN,
  INVENTORY_SLOTS_MAX,
  INVENTORY_SLOTS_MIN,
  inventoryRows,
  inventorySlotSize,
  DEFAULT_INVENTORY_SLOT_SIZE
} from "./inventory";

describe("getInventory", () => {
  it("defaults to the default slot count, columns and spacing with nothing saved, and no panel images", () => {
    expect(getInventory({})).toEqual(DEFAULT_INVENTORY);
    expect(getInventory({ inventory: {} })).toEqual(DEFAULT_INVENTORY);
    const data = getInventory({});
    expect(data.backgroundSpriteId).toBeUndefined();
    expect(data.slotSpriteId).toBeUndefined();
    expect(data.highlightSpriteId).toBeUndefined();
  });

  it("uses saved values as is, within range", () => {
    expect(getInventory({ inventory: { slots: 5, columns: 3, slotSpacingX: 1, slotSpacingY: 4 } })).toMatchObject({ slots: 5, columns: 3, slotSpacingX: 1, slotSpacingY: 4 });
  });

  it("passes through the three panel image ids", () => {
    const data = getInventory({ inventory: { backgroundSpriteId: "bg", slotSpriteId: "slot", highlightSpriteId: "hi" } });
    expect(data.backgroundSpriteId).toBe("bg");
    expect(data.slotSpriteId).toBe("slot");
    expect(data.highlightSpriteId).toBe("hi");
  });

  it("clamps a slot count outside INVENTORY_SLOTS_MIN..MAX", () => {
    expect(getInventory({ inventory: { slots: 0 } }).slots).toBe(INVENTORY_SLOTS_MIN);
    expect(getInventory({ inventory: { slots: 1000 } }).slots).toBe(INVENTORY_SLOTS_MAX);
    expect(getInventory({ inventory: { slots: -5 } }).slots).toBe(INVENTORY_SLOTS_MIN);
  });

  it("rounds a non-integer slot count", () => {
    expect(getInventory({ inventory: { slots: 4.6 } }).slots).toBe(5);
  });

  it("clamps columns to INVENTORY_COLUMNS_MIN..MAX, and additionally to at most the slot count", () => {
    expect(getInventory({ inventory: { columns: 0 } }).columns).toBe(INVENTORY_COLUMNS_MIN);
    expect(getInventory({ inventory: { slots: INVENTORY_SLOTS_MAX, columns: 999 } }).columns).toBe(INVENTORY_COLUMNS_MAX);
    expect(getInventory({ inventory: { slots: 3, columns: 20 } }).columns).toBe(3); // more columns than slots is never meaningful
  });

  it("clamps slot spacing to INVENTORY_SLOT_SPACING_MIN..MAX", () => {
    expect(getInventory({ inventory: { slotSpacingX: -5 } }).slotSpacingX).toBe(INVENTORY_SLOT_SPACING_MIN);
    expect(getInventory({ inventory: { slotSpacingY: 999 } }).slotSpacingY).toBe(INVENTORY_SLOT_SPACING_MAX);
  });
});

describe("clampMaxStack", () => {
  it("clamps to INVENTORY_MAX_STACK_MIN..MAX and rounds", () => {
    expect(clampMaxStack(0)).toBe(INVENTORY_MAX_STACK_MIN);
    expect(clampMaxStack(5000)).toBe(INVENTORY_MAX_STACK_MAX);
    expect(clampMaxStack(99.4)).toBe(99);
  });
});

describe("inventoryRows", () => {
  it("is however many rows slots needs at that many columns, at least 1", () => {
    expect(inventoryRows(20, 5)).toBe(4);
    expect(inventoryRows(21, 5)).toBe(5); // one more slot needs a new row
    expect(inventoryRows(3, 5)).toBe(1);
    expect(inventoryRows(0, 5)).toBe(1);
  });
});

describe("inventorySlotSize", () => {
  it("uses the slot image's own frame size when there is one", () => {
    expect(inventorySlotSize({ width: 32, height: 16, frameWidth: 16, frameHeight: 16 }, undefined)).toEqual({ width: 16, height: 16 });
  });

  it("falls back to the icon sheet's own frame size when there's no slot image", () => {
    expect(inventorySlotSize(undefined, { width: 64, height: 8, frameWidth: 8, frameHeight: 8 })).toEqual({ width: 8, height: 8 });
  });

  it("prefers the slot image over the icon sheet when both are set", () => {
    expect(inventorySlotSize({ width: 16, height: 16 }, { width: 8, height: 8 })).toEqual({ width: 16, height: 16 });
  });

  it("falls back to DEFAULT_INVENTORY_SLOT_SIZE when neither is set", () => {
    expect(inventorySlotSize(undefined, undefined)).toEqual({ width: DEFAULT_INVENTORY_SLOT_SIZE, height: DEFAULT_INVENTORY_SLOT_SIZE });
  });

  it("uses a picture's own plain width/height when it isn't a sheet (no frameWidth/frameHeight)", () => {
    expect(inventorySlotSize({ width: 16, height: 32 }, undefined)).toEqual({ width: 16, height: 32 });
  });
});
