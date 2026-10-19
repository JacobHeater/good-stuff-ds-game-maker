/**
 * An Inventory node (requirements/scene-designer/STORY.inventory.md): stack-based item storage a script can
 * `add`/`remove`/query from. Unlike TileMap3D's own per-node palette, items are a single, project-wide list
 * (`ProjectSnapshot.items`) -- a player's inventory, a chest, and a shop all deal in the exact same item
 * definitions, so an item picked up in one can be dropped into another.
 *
 * Icons are a single shared sprite sheet (`ProjectSnapshot.itemIconsSpriteId`, the same `ImportedSprite` a
 * Sprite2D's own sheet already is), each item picking one frame of it (`InventoryItem.iconFrame`) -- the same
 * "one sheet, picked by frame" shape `TileMap`'s own `spriteId` + per-cell frame already uses.
 *
 * An Inventory can also draw its own panel on screen, entirely from the engine, at this node's own position
 * (requirements/scene-designer/STORY.inventory-ui-panel.md): a background picture, a grid of per-slot pictures
 * (optionally a 2-frame sheet, empty/filled), each slot's own item icon drawn over it, a count label when a
 * stack holds more than one, and a highlight picture on whichever slot the player last touched. Every panel image
 * is optional and independent -- leaving all three unset draws nothing, same as a `Sprite2D` with no `spriteId`.
 */

/**
 * One item definition, shared project-wide. `name` is what a script names it by (`add("Sword", 1)`) -- the same
 * split `AudioClip` already has: `id` is a stable, invisible key (never shown, never typed), `name` is the one
 * user-facing string, editable at the cost of a rename needing its scripts updated too (accepted here exactly as
 * it already is for a named audio clip).
 */
export interface InventoryItem {
  id: string;
  name: string;
  /** A frame index into the project's `itemIconsSpriteId` sheet; absent for an item with no icon yet. */
  iconFrame?: number;
  maxStack: number;
}

export const INVENTORY_MAX_STACK_MIN = 1;
export const INVENTORY_MAX_STACK_MAX = 999;
export const DEFAULT_INVENTORY_ITEM_MAX_STACK = 99;

/** `maxStack`, clamped to `INVENTORY_MAX_STACK_MIN..MAX`. */
export function clampMaxStack(value: number): number {
  return Math.min(INVENTORY_MAX_STACK_MAX, Math.max(INVENTORY_MAX_STACK_MIN, Math.round(value)));
}

/** A node's own Inventory settings; only meaningful on an Inventory node. */
export interface InventoryData {
  /** How many anonymous stack-slots this instance has. */
  slots: number;
  /** The id of an image (in the project's `sprites`) drawn once behind the whole panel, at this node's own position; absent draws no background. */
  backgroundSpriteId?: string;
  /**
   * The id of an image drawn under every slot, tiled across the grid; absent draws no per-slot frame (just the
   * background and item icons, if those are set). A 2-frame sheet shows frame 0 for an empty slot and frame 1 for
   * a filled one; a plain, single-frame image always shows that one frame regardless of the slot's contents.
   */
  slotSpriteId?: string;
  /** The id of an image drawn over whichever slot the player last touched (STORY.inventory-ui-panel.md's own touch-to-select); absent draws no highlight. */
  highlightSpriteId?: string;
  /** How many slots wide the grid is; rows are however many `slots` needs at that width. */
  columns: number;
  /** Pixels between one slot's own corner and the next, on each axis. */
  slotSpacingX: number;
  slotSpacingY: number;
}

export const INVENTORY_SLOTS_MIN = 1;
export const INVENTORY_SLOTS_MAX = 64;
export const DEFAULT_INVENTORY_SLOTS = 20;

export const INVENTORY_COLUMNS_MIN = 1;
export const INVENTORY_COLUMNS_MAX = INVENTORY_SLOTS_MAX;
export const DEFAULT_INVENTORY_COLUMNS = 5;

export const INVENTORY_SLOT_SPACING_MIN = 0;
export const INVENTORY_SLOT_SPACING_MAX = 32;
export const DEFAULT_INVENTORY_SLOT_SPACING = 2;

/** A slot's own pixel size when neither a slot image nor the project's item-icon sheet says otherwise (one of the DS's own sprite sizes). */
export const DEFAULT_INVENTORY_SLOT_SIZE = 16;

export const DEFAULT_INVENTORY: Readonly<InventoryData> = {
  slots: DEFAULT_INVENTORY_SLOTS,
  columns: DEFAULT_INVENTORY_COLUMNS,
  slotSpacingX: DEFAULT_INVENTORY_SLOT_SPACING,
  slotSpacingY: DEFAULT_INVENTORY_SLOT_SPACING
};

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** A node's Inventory settings, defaulted and clamped. `columns` is additionally kept to at most `slots` (more columns than slots is never meaningful). */
export function getInventory(node: { inventory?: Partial<InventoryData> }): InventoryData {
  const data = node.inventory ?? {};
  const slots = clampInt(data.slots, INVENTORY_SLOTS_MIN, INVENTORY_SLOTS_MAX, DEFAULT_INVENTORY.slots);
  const columns = Math.min(slots, clampInt(data.columns, INVENTORY_COLUMNS_MIN, INVENTORY_COLUMNS_MAX, DEFAULT_INVENTORY.columns));
  return {
    slots,
    backgroundSpriteId: data.backgroundSpriteId,
    slotSpriteId: data.slotSpriteId,
    highlightSpriteId: data.highlightSpriteId,
    columns,
    slotSpacingX: clampInt(data.slotSpacingX, INVENTORY_SLOT_SPACING_MIN, INVENTORY_SLOT_SPACING_MAX, DEFAULT_INVENTORY.slotSpacingX),
    slotSpacingY: clampInt(data.slotSpacingY, INVENTORY_SLOT_SPACING_MIN, INVENTORY_SLOT_SPACING_MAX, DEFAULT_INVENTORY.slotSpacingY)
  };
}

/** How many rows the grid needs to hold `slots` at `columns` wide. */
export function inventoryRows(slots: number, columns: number): number {
  return Math.max(1, Math.ceil(slots / Math.max(1, columns)));
}

/**
 * A slot's own pixel size: the slot image's own frame size if there is one, else the project's item-icon sheet's
 * own frame size if there is one, else `DEFAULT_INVENTORY_SLOT_SIZE` -- so layout and touch hit-testing have a
 * sensible size to work with even before any image is actually chosen.
 */
export function inventorySlotSize(
  slotSprite: { width: number; height: number; frameWidth?: number; frameHeight?: number } | undefined,
  iconSheet: { width: number; height: number; frameWidth?: number; frameHeight?: number } | undefined
): { width: number; height: number } {
  const source = slotSprite ?? iconSheet;
  if (!source) return { width: DEFAULT_INVENTORY_SLOT_SIZE, height: DEFAULT_INVENTORY_SLOT_SIZE };
  return { width: source.frameWidth ?? source.width, height: source.frameHeight ?? source.height };
}
