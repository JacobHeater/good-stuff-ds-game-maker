---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.tile-map-3d.md, STORY.named-audio-clips.md]
---

# Story: An Inventory node (stack-based item storage, with a project-wide item list)

## Context
Owner request: "let's add a new Inventory Node it can have items with a icon and max in a stack and more." Asked
whether items should be a per-node palette (like TileMap3D's own) or one shared, project-wide list, the owner chose
the shared list explicitly, overriding the per-node option this plan itself initially recommended as simpler: a
player's inventory, a chest, and a shop should all deal in the exact same item definitions, so an item picked up in
one can be dropped into another.

## Description
- A new `Inventory` node kind (`packages/core/src/inventory.ts`), engine-independent like `AudioStreamPlayer` (it
  makes no sound and draws nothing itself, so it has no position to edit, and no 3D/2D nesting restriction). Its own
  data is tiny: just `{ slots }`, how many anonymous stack-slots this one instance has (1..64). Which items exist is
  **not** stored per-node at all.
- **The project's shared item list** (`ProjectSnapshot.items: InventoryItem[]`, plus `itemIconsSpriteId` naming one
  shared icon sheet in `ProjectSnapshot.sprites`): each `InventoryItem` is `{ id, name, iconFrame?, maxStack }`.
  `name` is what a script's `add("Sword", 1)` matches against -- the same "matched by name, not by id" split a named
  audio clip already has (`AudioClip.id` is likewise never what a script types); `id` is a stable, invisible React
  key. `iconFrame` is a frame index into the one shared icon sheet (absent: no icon yet) -- the same "one sheet,
  picked by frame" shape `TileMap`'s own sheet + per-cell frame already uses, chosen specifically so showing an
  icon at runtime stays a small, bounded primitive (`gs_sprite_set_frame`, below) instead of needing dynamic
  image-swapping. Items are never auto-pruned when a scene is saved (like `scripts`, not like `meshes`/`textures`):
  a script names one by a string literal in its own source text, not a scannable node field, so nothing here can
  safely be inferred "unused." The icon sheet itself *is* kept alive by `pruneUnusedAssets` whenever any item
  actually has an `iconFrame`.
- **Script API** on an Inventory node: `add(item, count) -> int` (fills same-item slots first, then empty ones,
  respecting each item's own `maxStack`; returns how many did *not* fit), `remove(item, count) -> int` (how many
  were actually removed, capped at what's there), `count(item) -> int` (total across every slot), `slot_count(slot)
  -> int`, `slot_item_is(slot, item) -> bool`, `slot_icon(slot) -> int` (that slot's own item's icon frame, or -1
  when empty). An `item` argument is always a string literal, resolved at **compile time** against the project's
  own item list (an unknown name is a compile error naming the ones that do exist) -- exactly how `play("name")`
  already resolves a named audio clip to a compile-time index; `slot`/`count` stay ordinary int expressions (a
  variable is fine, not just a literal).
- **`gs_sprite_set_frame(node, frame)`** (new, small runtime primitive, not an Inventory-specific one): directly
  shows a frame of a Sprite2D/AnimatedSprite2D's own sheet, stopping any animation playing on it. The one genuinely
  new rendering capability this story needed -- rendering itself stays entirely the game's own job (no automatic
  inventory UI is drawn by the engine): a script reads `slot_icon(n)` and calls `set_frame(frame)` on a Sprite2D
  already wired (in the editor, like any ordinary sprite) to the same shared icon sheet.
- **Compiling**: the full, project-ordered item list compiles into *every* scene (3D or 2D), not a per-scene-used
  subset the way meshes/textures are deduplicated -- `script_code.c` is already project-wide (every scene shares
  it), so a compiled script's own item index has to mean the same project item no matter which scene is running
  when it executes. An Inventory node compiles like a collision shape in 3D (kept whenever the node itself is, not
  gated on being reached by a script) but like one in a standalone 2D project (only compiled if a script actually
  names or attaches to it -- a 2D project's node table holds only what scripts can reach at all).
- **The editor**: the Inspector's own `InventoryField.tsx` has the node's own Slots field, then the project-wide
  item manager (choose/import the icon sheet, add/remove items, each with its name, a click-to-pick icon-frame
  picker reusing `TileMap`'s own sheet-frame-button pattern, and its max stack) -- shown here because nothing else
  in this editor has a dedicated "project assets" panel, and Inventory is the only node kind that cares about items.

## Acceptance Criteria
```gherkin
Scenario: A new Inventory starts with the default slot count
  Given an Inventory is added
  Then its own Slots field reads 20, and it has no position to edit

Scenario: Items are project-wide, not per-node
  Given two Inventory nodes in the same project
  When an item is added in the Inspector
  Then both nodes' own add()/remove()/count() can use it by the same name

Scenario: add() stacks across slots and reports what didn't fit
  Given an Inventory with 2 slots and an item with max stack 10, already holding 10 + 5 of it
  When a script calls add(item, 20)
  Then the second slot fills to 10 and add() returns 15 (what had nowhere to go)

Scenario: remove() never takes more than exists
  Given an Inventory holding 20 of an item total
  When a script calls remove(item, 25)
  Then only 20 are actually removed, and remove() returns 20

Scenario: An unknown item name is a compile error
  Given a script calling $Bag.add("Ghost", 1) and no project item named "Ghost"
  Then the whole scene fails to compile, naming the items that do exist

Scenario: set_frame() shows a different picture on real hardware
  Given a Sprite2D wired to a two-frame sheet, and a script that calls set_frame(1) on a button press
  Then the sprite shows frame 0 at idle and frame 1 while the button is held, confirmed on a real capture
```

## Notes
- **Architecture validated against the real codebase before writing code**: `rom-builder.ts`'s own `buildScenes`
  (3D) shares `scene_table.c`/`script_code.c` project-wide, but `build2D` (standalone 2D) only ever takes a single
  scene with no multi-file sharing mechanism at all -- this directly ruled out inventing a new "shared project-wide
  C file" approach (it would only ever be usable from the 3D tree) in favor of simply duplicating the full,
  identically-ordered item list into every scene's own compiled data, the same simple pattern every other compiled
  table already uses.
- **A real, latent editor-store bug found building this, not by this feature itself**: `editorReducer`'s own
  `changed` detector (deciding whether an action actually touched anything undo-worthy) and the `EditState`
  snapshot `restore()` puts back on Undo both listed every project-level array (`meshes`, `textures`, `sounds`,
  `sprites`, `scripts`) by name, with no path for a future one to be added by accident -- adding `items`/
  `itemIconsSpriteId` without also adding them to both of those exposed that every one of the new Inventory
  project-level actions silently applied correctly but **never undid** (Undo was a no-op). Fixed in both spots
  (`editor-store.tsx`'s `changed` check and `restore()`, `edit-history.ts`'s own `EditState`); a lesson for the
  next project-level (not per-node) editor action this engine adds.
- **Script resolution is by item `name`, not `id`, matching `AudioClip`'s own precedent** (a design correction made
  mid-build, before anything downstream depended on the other choice): an early draft had `id` be the stable,
  script-facing string and `name` a separate cosmetic label -- safer against a rename breaking old scripts, but
  inconsistent with how a named audio clip already works in this engine (`play("name")` matches `AudioClip.name`,
  and renaming one is an accepted, already-shipped tradeoff). Switched before the editor UI was built, so there's
  only ever been one user-facing text field to design around, not two confusingly similar ones.
- **Hardware verification**: `packages/compiler/src/testing/inventory.rom.test.ts` (permanent, not throwaway --
  this project's own established discipline since the sky box story shipped once with only a manual check and a
  real bug reached the owner undetected) covers the full add/remove/count/slot_count/slot_item_is/slot_icon
  arithmetic on a real ARM9 via on-screen Label values, and a separate capture confirms `gs_sprite_set_frame`
  actually changes which graphic an OAM sprite shows. **Passed on real melonDS** once the Windows session (locked
  while this story was first written) was unlocked: `leftover=15`, `slot 1=5` (after the first two adds overflow
  into it, before the third fills it the rest of the way), `removed=20`, `count()=0` once empty, `slot_icon()=3`,
  `slot_item_is()=true` all read correctly off the captured screen, and `gs_sprite_set_frame` showed red (frame 0)
  idle and blue (frame 1) while the test script's own button was held. One real bug caught in the test itself (not
  the runtime): the `slotTwo` label's own comment/expected value assumed slot 1 would already be *full* (10) at
  that checkpoint, but the script reads it before the third `add()` runs, when it only holds the second add's own
  overflow (5) -- fixed by correcting the test's comment and expected width, not the runtime, which was already
  right. The emulator capture tooling (`melonds-input.ps1`) was intermittently flaky under rapid, repeated manual
  relaunches in the same few seconds (a window-handle/process-contention issue, not a ROM or logic defect) --
  a single clean run, with no interference between captures, passed outright both times it was tried that way.
- **Not built:** automatic slot-grid UI rendering (the game draws its own inventory screen, same philosophy as
  everywhere else in this engine), item categories/value/weight/"use" effects, in-editor slot arrangement (slots are
  anonymous; `add()` fills the first that fit), a dedicated transfer-between-inventories primitive (a script can
  already `remove()` from one and `add()` to another), and automatic pruning of unused items (manual removal only,
  like `scripts`).
