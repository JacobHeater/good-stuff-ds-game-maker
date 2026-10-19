import { useEffect, useState } from "react";

import {
  clampMaxStack,
  getInventory,
  getSpriteFrames,
  INVENTORY_COLUMNS_MAX,
  INVENTORY_COLUMNS_MIN,
  INVENTORY_MAX_STACK_MAX,
  INVENTORY_MAX_STACK_MIN,
  INVENTORY_SLOT_SPACING_MAX,
  INVENTORY_SLOT_SPACING_MIN,
  INVENTORY_SLOTS_MAX,
  INVENTORY_SLOTS_MIN,
  SPRITE_SIZES,
  type ImportedSprite,
  type InventoryItem,
  type SceneNode
} from "@goodstuff/core";

import type { InventoryChange, InventoryPanelImageTarget } from "../state/editor-store";
import { spriteFrameDataUrl } from "../viewport/sprite-image";
import { SheetPreview } from "./AnimatedSpriteFields";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

/**
 * An Inventory node's own slot count and on-screen panel, plus the project's shared item list
 * (requirements/scene-designer's own STORY.inventory.md, STORY.inventory-ui-panel.md): unlike TileMap3D's own
 * per-node palette, the items here belong to the whole project, not this one node -- a player's inventory, a chest
 * and a shop all pick from the exact same list, which is why it's edited here rather than per-node (nothing else
 * in this editor has a dedicated "project assets" panel, and Inventory is the only kind that cares about items).
 * A script's own `add("Name", ...)` matches an item by its `name` (the same "matched by name, not by id" split a
 * named audio clip already has), so renaming one here means updating any script that already names it -- the same
 * accepted tradeoff as renaming a named sound.
 *
 * The panel itself (background, slot and highlight pictures, grid layout) is entirely optional: leaving all three
 * images unset draws nothing, same as a `Sprite2D` with no image chosen.
 */
export function InventoryField({
  node,
  items,
  itemIconsSpriteId,
  sprites,
  onChange,
  onChooseIconSheet,
  onImportIconSheet,
  onImportPanelImage,
  onAddItem,
  onRemoveItem,
  onChangeItem
}: {
  node: SceneNode;
  items: readonly InventoryItem[];
  itemIconsSpriteId: string | undefined;
  sprites: readonly ImportedSprite[];
  onChange: (change: InventoryChange) => void;
  onChooseIconSheet: (spriteId: string | null) => void;
  onImportIconSheet: (frame?: { width: number; height: number }) => void;
  onImportPanelImage: (target: InventoryPanelImageTarget, frame?: { width: number; height: number }) => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onChangeItem: (itemId: string, change: Partial<Pick<InventoryItem, "name" | "iconFrame" | "maxStack">>) => void;
}): JSX.Element {
  const inventory = getInventory(node);
  const sheet = sprites.find((s) => s.id === itemIconsSpriteId);
  const missing = itemIconsSpriteId !== undefined && !sheet;
  const frames = sheet ? getSpriteFrames(sheet) : null;
  const [pickingIconFor, setPickingIconFor] = useState<string | null>(null);
  const [iconFrameSize, setIconFrameSize] = useState("16x16");

  return (
    <div className="flex flex-col gap-2" data-testid="inventory-field">
      <Field label="Slots">
        <input
          type="number"
          min={INVENTORY_SLOTS_MIN}
          max={INVENTORY_SLOTS_MAX}
          value={inventory.slots}
          onChange={(event) => onChange({ slots: Number(event.target.value) })}
          className={inputClasses}
        />
      </Field>

      <div className="text-[11px] font-semibold text-editor-text">Panel (drawn automatically at this node's own position; leave the images unset to draw nothing)</div>
      <PanelImageField label="Background" spriteId={inventory.backgroundSpriteId} sprites={sprites} onChoose={(spriteId) => onChange({ backgroundSpriteId: spriteId })} onImport={() => onImportPanelImage("background")} />
      <PanelImageField
        label="Slot"
        spriteId={inventory.slotSpriteId}
        sprites={sprites}
        onChoose={(spriteId) => onChange({ slotSpriteId: spriteId })}
        onImport={(frame) => onImportPanelImage("slot", frame)}
        frames
      />
      <div className="text-[10px] text-editor-text-muted">A slot image with two frames shows the first for an empty slot and the second for a filled one.</div>
      <PanelImageField label="Highlight" spriteId={inventory.highlightSpriteId} sprites={sprites} onChoose={(spriteId) => onChange({ highlightSpriteId: spriteId })} onImport={() => onImportPanelImage("highlight")} />
      <div className="text-[10px] text-editor-text-muted">Shown over whichever slot the player last touched (a script reads it with selected_slot()).</div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Columns">
          <input type="number" min={INVENTORY_COLUMNS_MIN} max={INVENTORY_COLUMNS_MAX} value={inventory.columns} onChange={(event) => onChange({ columns: Number(event.target.value) })} className={inputClasses} />
        </Field>
        <Field label="Spacing X">
          <input type="number" min={INVENTORY_SLOT_SPACING_MIN} max={INVENTORY_SLOT_SPACING_MAX} value={inventory.slotSpacingX} onChange={(event) => onChange({ slotSpacingX: Number(event.target.value) })} className={inputClasses} />
        </Field>
        <Field label="Spacing Y">
          <input type="number" min={INVENTORY_SLOT_SPACING_MIN} max={INVENTORY_SLOT_SPACING_MAX} value={inventory.slotSpacingY} onChange={(event) => onChange({ slotSpacingY: Number(event.target.value) })} className={inputClasses} />
        </Field>
      </div>

      <div className="text-[11px] font-semibold text-editor-text">Items (shared by every Inventory in the project)</div>

      <Field label="Icon sheet">
        <select value={itemIconsSpriteId ?? ""} onChange={(event) => onChooseIconSheet(event.target.value === "" ? null : event.target.value)} className={inputClasses}>
          <option value="">None</option>
          {sprites.map((sprite) => (
            <option key={sprite.id} value={sprite.id}>
              {sprite.name} ({getSpriteFrames(sprite).count} frame{getSpriteFrames(sprite).count === 1 ? "" : "s"})
            </option>
          ))}
          {missing && (
            <option value={itemIconsSpriteId} disabled>
              (missing image)
            </option>
          )}
        </select>
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Frame size (one icon's own size)">
          <select value={iconFrameSize} onChange={(event) => setIconFrameSize(event.target.value)} className={inputClasses} data-testid="icon-sheet-frame-size">
            {SPRITE_SIZES.map((size) => (
              <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                {size.width} x {size.height}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={buttonClasses}
          onClick={() => {
            const [width, height] = iconFrameSize.split("x").map(Number);
            onImportIconSheet({ width, height });
          }}
          data-testid="import-item-icons"
        >
          Import icon sheet PNG...
        </button>
      </div>
      {sheet && frames && frames.count === 1 && (
        <div className="text-[10px] text-amber-400">This image has only one frame -- pick a smaller frame size above and re-import if it's really a sheet of several icons.</div>
      )}
      {sheet && <SheetPreview sheet={sheet} />}

      {items.length === 0 && <div className="text-[11px] text-editor-text-muted">No items yet.</div>}
      {items.length > 0 && !sheet && <div className="text-[11px] text-editor-text-muted">Choose or import an icon sheet above to pick each item's own icon.</div>}
      <div className="flex flex-col gap-2" data-testid="item-list">
        {items.map((item) => {
          const iconUrl = sheet && item.iconFrame !== undefined ? spriteFrameDataUrl(sheet, item.iconFrame) : null;
          const picking = pickingIconFor === item.id;
          return (
            <div key={item.id} data-testid={`item-${item.id}`} className="flex flex-col gap-1 rounded border border-editor-border p-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="Choose this item's icon"
                  disabled={!frames}
                  onClick={() => setPickingIconFor(picking ? null : item.id)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center border text-[10px] text-editor-text-muted ${picking ? "border-editor-accent" : "border-editor-border"}`}
                >
                  {iconUrl ? <img src={iconUrl} alt="" className="h-full w-full" style={{ imageRendering: "pixelated" }} /> : "?"}
                </button>
                <ItemNameField value={item.name} onChange={(name) => onChangeItem(item.id, { name })} />
                <button type="button" title="Remove this item" aria-label="Remove item" onClick={() => onRemoveItem(item.id)} className="px-1 text-editor-text-muted hover:text-editor-text">
                  ×
                </button>
              </div>
              <Field label="Max stack">
                <input
                  type="number"
                  min={INVENTORY_MAX_STACK_MIN}
                  max={INVENTORY_MAX_STACK_MAX}
                  value={item.maxStack}
                  onChange={(event) => onChangeItem(item.id, { maxStack: clampMaxStack(Number(event.target.value)) })}
                  className={inputClasses}
                />
              </Field>
              {picking && frames && sheet && (
                <div className="flex flex-wrap gap-1" data-testid={`icon-picker-${item.id}`}>
                  {Array.from({ length: frames.count }, (_, frame) => {
                    const url = spriteFrameDataUrl(sheet, frame);
                    return (
                      <button
                        key={frame}
                        type="button"
                        onClick={() => {
                          onChangeItem(item.id, { iconFrame: frame });
                          setPickingIconFor(null);
                        }}
                        className={`border ${item.iconFrame === frame ? "border-editor-accent" : "border-editor-border"}`}
                        style={{ width: frames.frameWidth * 2, height: frames.frameHeight * 2 }}
                      >
                        {url && <img src={url} alt="" className="h-full w-full" style={{ imageRendering: "pixelated" }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className={buttonClasses} onClick={onAddItem} data-testid="add-item">
        Add item
      </button>
    </div>
  );
}

/**
 * One panel image field: choose an existing project sprite, or import a new PNG and use it directly. `frames`
 * (the Slot image only -- STORY.inventory-ui-panel.md's own "empty/filled" 2-frame sheet) adds the same "pick a
 * frame size, then import" flow `SpriteSheetField` already uses for an AnimatedSprite2D's own sheet: without it,
 * a sprite sheet imports as a single, uncut frame (a real bug this fixes -- the picture showed on screen exactly
 * as drawn, two frames side by side as one wide picture, because nothing ever told the importer to slice it).
 */
function PanelImageField({
  label,
  spriteId,
  sprites,
  onChoose,
  onImport,
  frames = false
}: {
  label: string;
  spriteId: string | undefined;
  sprites: readonly ImportedSprite[];
  onChoose: (spriteId: string | null) => void;
  onImport: (frame?: { width: number; height: number }) => void;
  frames?: boolean;
}): JSX.Element {
  const [frameSize, setFrameSize] = useState("16x16");
  const missing = spriteId !== undefined && !sprites.some((s) => s.id === spriteId);
  const sprite = sprites.find((s) => s.id === spriteId);
  const spriteFrames = sprite ? getSpriteFrames(sprite) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Field label={label}>
          <select value={spriteId ?? ""} onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)} className={inputClasses}>
            <option value="">None</option>
            {sprites.map((sprite) => (
              <option key={sprite.id} value={sprite.id}>
                {sprite.name}
                {frames ? ` (${getSpriteFrames(sprite).count} frame${getSpriteFrames(sprite).count === 1 ? "" : "s"})` : ""}
              </option>
            ))}
            {missing && (
              <option value={spriteId} disabled>
                (missing image)
              </option>
            )}
          </select>
        </Field>
        {frames && (
          <Field label="Frame size">
            <select value={frameSize} onChange={(event) => setFrameSize(event.target.value)} className={inputClasses} data-testid={`inventory-${label.toLowerCase()}-frame-size`}>
              {SPRITE_SIZES.map((size) => (
                <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                  {size.width} x {size.height}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button
          type="button"
          className={buttonClasses}
          onClick={() => {
            if (!frames) return onImport();
            const [width, height] = frameSize.split("x").map(Number);
            onImport({ width, height });
          }}
          data-testid={`import-inventory-${label.toLowerCase()}`}
        >
          Import{frames ? " sheet" : ""}...
        </button>
      </div>
      {frames && sprite && spriteFrames && spriteFrames.count === 1 && <div className="text-[10px] text-amber-400">This image has only one frame, so a filled slot looks the same as an empty one.</div>}
      {frames && sprite && spriteFrames && spriteFrames.count > 2 && (
        <div className="text-[10px] text-amber-400">This image has {spriteFrames.count} frames; only the first two are used (empty, then filled).</div>
      )}
      {frames && sprite && <SheetPreview sheet={sprite} />}
    </div>
  );
}

/** An item's name, keeping its own text while typed in (an empty name isn't applied, and the field shows the real one again when it loses focus). */
function ItemNameField({ value, onChange }: { value: string; onChange: (name: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <input
      type="text"
      value={draft}
      aria-label="Item name"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(value);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() !== "") onChange(event.target.value);
      }}
      className={`${inputClasses} flex-1`}
    />
  );
}
