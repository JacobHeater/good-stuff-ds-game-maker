---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.inventory.md]
---

# Story: An Inventory's own on-screen panel (an auto-drawn, dev-customizable inventory screen)

## Context
Follow-up to the just-shipped Inventory node (`STORY.inventory.md`): that story deliberately drew nothing
automatically ("rendering stays entirely the game's own job"). Owner's new request: "in the game there is no
inventory UI but the dev should be able to make on[e] by adding slot image and background image and other useful
things" -- i.e. reverse that one specific decision. Asked whether this means new Inspector fields on the Inventory
node itself that the *engine* lays out and draws automatically, vs. new conveniences for a dev to hand-assemble
their own UI from ordinary nodes, the owner chose the first, explicitly recommended, option. A follow-up question
narrowed "other useful things" to three confirmed extras: stack-count text per slot, touch-to-select a slot (with a
highlight image on the selected one), and columns/spacing layout controls.

## Description
- **`InventoryData` gains optional panel fields** (`packages/core/src/inventory.ts`): `backgroundSpriteId?`,
  `slotSpriteId?` (optionally a 2-frame sheet: frame 0 for an empty slot, frame 1 for a filled one, a plain
  single-frame image always showing that one frame regardless), `highlightSpriteId?` (shown on the selected slot),
  `columns` (1..slots, default 5), `slotSpacingX`/`slotSpacingY` (pixels, default 2, each independently clamped).
  `rows` is derived (`inventoryRows`), not stored. A slot's own pixel size for layout and touch hit-testing
  (`inventorySlotSize`) comes from whichever image is actually set -- the slot image's own frame size, else the
  project's item-icon sheet's own frame size, else a 16x16 fallback -- no separate Inspector field for it.
- **`Inventory` became a real 2D visual kind again**, like `Sprite2D`/`Label`: removed from the editor's own
  `isEngineIndependent` list, so it falls through to the ordinary Position X/Y + Screen fields every other 2D node
  already has. A panel is drawn at this node's own starting position.
- **Script API, two new Inventory methods**, same dispatch machinery the six existing ones already use:
  `selected_slot() -> int` (-1 if none) and `select_slot(slot)` (sets it directly, out-of-range or -1 clears it) --
  lets a script react to a tap (use/drop the selected item) and clear the selection itself. Neither has an `item`
  argument to resolve, unlike every other Inventory method. **A real gap this surfaced**: the Inventory node's own
  `visible` was never scriptable at all -- the base story never needed it (an Inventory with no panel has nothing
  to show or hide), but a panel genuinely does, and the checker's own kind-capability map only had `visible` go
  through `isLabelTarget`/the 3D-only `transform` capability, neither of which an Inventory matched. Fixed with a
  dedicated `isInventoryTarget` check, deliberately narrower than a full `transform` grant: only `visible`, not
  `position`/`rotation`/`scale`, since the panel's own v1 never reads those live (see below).
- **Compiling** (`translate-scene-2d.ts`, shared by both the 3D-project 2D-screen path and standalone 2D):
  `collectSprites`/`collectLabels` gained a new extension point, `collectInventoryPanel`, called from inside
  `collectSprites`'s own per-node loop with the *exact same* "nothing reaches it, nothing is built" gate
  `collectInventory2D` itself already uses (so a panel's sprites are never compiled with no `DsInventory` entry
  left to reference them). It appends, into the *same* mutable per-screen arrays an ordinary Sprite2D/Label
  already shares (not a table of its own -- the DS's OAM sprite slots and 16 extended palettes are allocated
  purely by array position at runtime, so there is only ever one real table to share): 1 background sprite
  (optional), `slots` slot-frame sprites (optional), `slots` item-icon sprites (present whenever *any* panel image
  is set, independently of whether the project has an icon sheet -- see the correctness note below), 1 highlight
  sprite (optional), and `slots` stack-count labels (always present, text fixed at compile time as `"x{}"`, hidden
  to start). `DsInventory`/`GsInventory` (both runtimes) gained the compiled layout and sprite/label index ranges
  (`panelX/Y`, `columns`, `slotWidth/Height`, `spacingX/Y`, `backgroundSprite`, `slotSpriteStart`, `iconSpriteStart`,
  `highlightSprite`, `labelStart`, each a plain int, -1/0 meaning "not configured"), plus (2D runtime only) a
  `screen` field saying which of the two screens the indices are into -- a 3D project's own `GsInventory` (scene.h)
  never needed this, since it only ever has the one 2D screen to begin with. The label budget check moved from
  inside `collectLabels` to after `collectSprites`'s own sprite-budget checks, so it covers the combined
  real-plus-panel count.
- **Runtime** (both trees): a new per-frame update (`gs_update_inventory_panel` in the 3D tree's `gs_inventory.c`;
  `update_inventory_panel` in the 2D tree's `main.c`, since that tree already plays the part of `gs_sprites.c`/
  `gs_labels.c` itself), called once a frame right before the sprite/label tables are flushed to hardware (not
  after -- their own flush happens only once a frame, so anything the panel changes has to land before it or wait
  an extra frame to show). Per configured panel: hides/shows every one of its own sprites and labels from the
  Inventory node's own live `visible` (direct, not through the node-following `follow()`/`follow_sprite()` every
  ordinary dynamic sprite uses, since a panel sprite has no node of its own); swaps each slot-frame sprite's own
  empty/filled frame and each icon sprite's own graphic from `gs_inventory_slot_icon`; hit-tests `gs_touching`/
  `gs_touch_x`/`gs_touch_y` (plain globals, already independent of any `TouchArea2D`) against the panel's own
  fixed grid, selecting a slot on a tap inside it and leaving the selection alone otherwise; moves the highlight
  sprite to the selected slot's own cell; and shows/hides each count label (not changes its text) based on whether
  its own slot holds more than one. New small, by-raw-index sibling primitives alongside the existing node-based
  ones made this possible without inventing a parallel drawing path: `gs_sprite_set_hidden_at`/`_xy_at`/`_frame_at`
  (3D tree's `gs_sprites.c`) and `gs_label_set_value_at`/`_shown_at` (3D tree's `gs_labels.c`); the 2D tree's own
  copies are local `static` functions in `main.c`, since `screens[]`/`labelScreens[]` already live there.
- **The editor**: `InventoryField.tsx` gained a "Panel" section (Background/Slot/Highlight image choose+import
  fields, identical pattern to the existing item-icon-sheet field, plus Columns/Spacing X/Y number fields) above
  the existing project-wide item list. `InspectorPanel.tsx`'s position-dispatch chain lost its `Inventory`
  "no position" branch.
- **Explicitly out of scope for v1**: the panel following its own node if a script moves it after the scene
  starts (only its `visible` is tracked live -- documented, not silently broken); drag-and-drop between slots; any
  open/close animation; more than one look per Inventory; a scrollable panel (slots beyond the configured grid
  simply aren't drawn, the same "diagnostics catch overflow" philosophy as everything else).

## Acceptance Criteria
```gherkin
Scenario: A panel with no images draws nothing, same as a Sprite2D with no image
  Given an Inventory with no background/slot/highlight image chosen
  Then no panel sprites or labels are compiled for it, even with a project-wide icon sheet

Scenario: A panel's sprites/labels share the exact same per-screen budget as ordinary nodes
  Given a screen already at 128 sprites (the DS's own OAM limit)
  When an Inventory with a panel configured is added to the same screen
  Then too-many-sprites fires, the same diagnostic an ordinary Sprite2D overflow already gives

Scenario: A panel still shows its background/slot frames/highlight with no icon sheet
  Given an Inventory with a background, slot and highlight image but no project-wide icon sheet
  Then its background/slot-frame/highlight sprites and labels still compile; only its icon sprites don't

Scenario: Touching a slot selects it, moving the highlight there
  Given a panel with a highlight image, nothing selected
  When the player taps inside slot 1's own cell
  Then selected_slot() returns 1 and the highlight sprite moves onto that cell

Scenario: The panel disappears when the Inventory's own visible is set false
  Given a configured, visible panel
  When a script sets visible = false on the Inventory
  Then every one of its sprites and labels hides, confirmed on real hardware
```

## Notes
- **A real correctness bug caught before it shipped, not from a failing test**: the DS's sprite-array reversal
  (`collectSprites`'s own `.reverse()`, so the hardware draws the lowest-numbered sprite on top, matching "later in
  tree = drawn on top") both moves *and* internally re-orders a contiguous run of sprites pushed together, breaking
  naive sequential indexing for a panel's own multi-sprite runs (`slotSpriteStart`/`iconSpriteStart`). Solved by
  deriving the exact remap formula (`finalIndex = totalLength - 1 - rawIndex`) and adopting the "`*Start - n`, not
  `+ n`" indexing convention for a run, applied via a deferred remap pass once the whole screen's own sprite count
  is known (not computable earlier, since the array isn't finished until the per-node loop is).
- **Two more real gaps found while implementing, neither from a failing test**: (1) a stale doc comment on
  `GsInventory` (scene.h) claimed its panel fields were "only meaningful when `iconSpriteStart >= 0`" -- wrong,
  since a panel can exist with no icon sheet at all (`iconSpriteStart == -1`) while its background/slot/highlight
  are fully configured; fixed before it could mislead the runtime implementation that followed it. (2) the
  standalone 2D runtime has *two* screens, but `GsInventory`'s compiled sprite/label indices said nothing about
  *which* screen they were into -- harmless for a 3D project (only ever one 2D screen) but a real correctness gap
  for 2D, caught by reasoning through the runtime implementation before writing it, not by a test failure. Fixed by
  adding a `screen` field, 2D-runtime-only (matching the precedent `GsAudioPlayer`'s own 2D-only extra `node` field
  already set, for the same "2D has more screens to search" reason).
- **A real, previously-undiscovered gap in the script checker, caught by the permanent hardware test itself, not
  by a unit test**: the ROM test's own `visible = false` line failed to compile ("visible isn't available on Bag (a
  Inventory)") -- the base Inventory story never gave a script any reason to read or write an Inventory's own
  `visible`, so nothing in the checker's kind-capability map ever granted it. Fixed with a narrow, Inventory-only
  `isInventoryTarget` capability (just `visible`, not `position`/`rotation`/`scale`, which the panel's own v1 never
  reads live anyway) -- a good example of why the permanent hardware test is written *before* calling a story done,
  not treated as a formality after the unit tests pass.
- **Hardware verification**: `packages/compiler/src/testing/inventory-ui-panel.rom.test.ts` (permanent). One ROM,
  three captures: idle (background/empty slot frame visible, no icon, no highlight, `selected_slot()` reads -1);
  holding "a" (`add("Gem", 2)` with `maxStack: 1` fills both one-slot-at-a-time slots) while clicking slot 1's own
  cell (an item's icon appears at slot 0, the highlight moves onto slot 1 covering its own icon there, and
  `selected_slot()` reads 1); holding "b" (the Inventory's own script sets `visible = false`, and the whole panel,
  background included, disappears). **Passed on real melonDS**: `idleBg≈(16,195,16)` (green background),
  `idleCell0=(130,130,130)` (grey, empty), `idleSelected=3` ("S-1"), `filledCell0≈(16,16,227)` (blue icon),
  `filledCell1≈(227,16,227)` (magenta highlight, covering the icon that's also there), `addClickSelected=2` ("S1"),
  `hiddenBg≈(81,40,24)` (the plain screen backdrop, not green -- the panel is gone). One test bug caught and fixed
  along the way, not a runtime bug: the first draft measured the "Selected" label's own text width against
  `BACKDROP_BLACK` (correct for `inventory.rom.test.ts`'s own labels, but those sit on a *3D* project's always-black
  sub-screen) instead of `BACKDROP_2D_PROJECT.bottom` -- this is a *standalone 2D* project, whose own bottom-screen
  backdrop isn't black, so the first run measured the label as 31 characters wide (the whole row) instead of 3.
- **Compiler-level verification**: `packages/compiler/src/inventory-panel.test.ts` (9 tests) proves the sharing
  itself, not just the runtime behavior: a panel's sprites/labels land in the exact same arrays an ordinary
  Sprite2D/Label already does, in correctly-reversed hardware order; the existing `too-many-sprites`/
  `too-many-sprite-palettes`/`too-many-labels` diagnostics fire once a panel pushes a screen over budget; a dangling
  panel image id gets the same `missing-sprite` error an ordinary Sprite2D does; and a panel with no icon sheet (or
  one whose only configured image is the highlight) still compiles everything else correctly.
- **Not built:** the panel following its own node if a script moves it after the scene starts; drag-and-drop
  between slots; any open/close animation or transition; more than one background/slot/highlight look per
  Inventory; a scrollable panel (slots beyond the configured grid simply aren't drawn).
- **A real post-ship bug, reported by the owner, not caught by any of this story's own tests**: "add a slot image
  [and an] icon image and the slot image is missing." `pruneUnusedAssets`/`withUpdatedScene`
  (`core/src/project-snapshot.ts`), which drops any imported sprite no node's own `spriteId` references (so saving
  the project after the last user of one is deleted doesn't leave its data behind), was never taught about a
  panel's own `backgroundSpriteId`/`slotSpriteId`/`highlightSpriteId` -- so as soon as anything triggered a prune
  (importing the icon sheet, among other things), it saw the slot image as "unused" and deleted it, even though
  the Inventory's own panel was still using it. The project's own `itemIconsSpriteId` had the same gap one level
  removed: it was kept alive only when some item had actually chosen an icon frame (`itemsUseIcons`), never by a
  panel directly drawing from it. Fixed by adding each of the three panel image ids to the sprite-usage scan
  (the same way a plain node's own `spriteId` already counts), and by also keeping `itemIconsSpriteId` alive
  whenever any Inventory has a panel configured, not just when an item uses a frame of it. New tests in
  `core/src/imported-sprite.test.ts` cover both (a panel's own three images survive a prune while still
  referenced, and are dropped once the panel is cleared; the icon sheet survives a prune for a configured panel
  with zero items using icons, and is dropped once neither is true).
- **A second real post-ship bug, also reported by the owner**: a slot image imported with "two frames" (per this
  field's own documented contract) showed in-game as one single uncut picture. Root cause: `importInventoryPanelImage`
  and `importItemIconSheet` (`ui/src/editor/state/editor-store.tsx`) both called the shared sprite importer
  (`window.goodstuff.assets.importSprite()`) with **no frame size at all** -- unlike `AnimatedSprite2D`'s own sheet
  field (`SpriteSheetField`, `AnimatedSpriteFields.tsx`), neither panel-image import nor icon-sheet import ever let
  the person pick one, so the importer always sliced the whole picture as a single frame regardless of what it
  actually showed. Fixed by giving both the same "pick a frame size, then import" flow `SpriteSheetField` already
  has -- a Frame size `<select>` next to the Import button (`PanelImageField`'s own new `frames` mode, used only
  by the Slot field; a matching one for the project-wide icon sheet) -- plus a frame-numbered preview
  (`SheetPreview`, lifted out of `AnimatedSpriteFields.tsx` and exported for reuse) so a person can see a sheet is
  actually cut apart before saving, and a warning when a chosen image has only 1 frame or more than 2. Owner asked,
  given the choice, to keep the shared icon sheet (not move to one distinct image per item -- the real cost of that
  would be one of the DS's own 16 palette slots per screen *per item*, capping the practical item count far below
  what a shared sheet allows) and improve picking instead; this fix plus the pre-existing per-item click-to-pick
  frame grid (`InventoryField.tsx`) is that improvement -- the grid already existed but was effectively unusable,
  since an icon sheet imported through the broken path was always exactly one frame. **This fix doesn't retroactively
  repair data already saved with a single uncut frame**; an already-imported sheet has to be re-imported through the
  new Frame size picker to actually be sliced.
- **A third real post-ship bug, again reported by the owner**: "when you click on an item the item disappears."
  `collectInventoryPanel` originally pushed a panel's sprites in the order background, slot frames, item icons,
  highlight -- meaning the highlight (topmost of the four, so it's visible at all once a slot is selected) was
  *also* drawn over a filled slot's own icon. A player touching an item's own slot didn't just select it; it
  replaced the item's own on-screen icon with the highlight image, exactly as a sighted test (not caught by any
  automated one, since this session's own hardware test was deliberately designed around opaque, same-size test
  images and checked the highlight's own color at the touched cell, which is self-consistently true either way
  the two are ordered) would show. Fixed by pushing the highlight *before* the icons instead -- background, slot
  frames, highlight, icons -- so an icon always draws over the highlight underneath it: a selected, filled slot
  still shows its own item clearly, with the highlight only showing where the icon itself is transparent or
  smaller than the cell (or, for an empty selected slot, not covered by anything at all). No runtime change
  needed -- the remap formula and `*Start - n` convention apply the same regardless of which group is pushed in
  which order, so this was a compiler-only reorder. The hardware test's own scenario (`inventory-ui-panel.rom.test.ts`)
  was redesigned to actually catch a regression of this kind: it now fills only one of its two slots and touches
  the *other*, empty one, so the highlight's own color is checked somewhere nothing else can be drawn over it,
  while the filled slot's own icon is checked separately, unselected and unambiguous -- the original version
  would have silently passed either way the two sprites were ordered, since both its own checks sampled a single,
  fully-opaque, same-size pixel that only ever shows whichever layer drew last. (Also fixed, found while rebuilding
  this test for the new scenario: the test's own script used `Input.is_button_down("a")`, which is true every
  single frame a key is held -- `add("Gem", 1)` with a `maxStack` of 5 then ran roughly 70 times across a
  1.2-second hold, overflowing into the *second* slot too once the first one filled, defeating the very scenario
  the rewrite needed. Fixed by switching to the edge-triggered `Input.is_button_pressed("a")`, true only on the
  one frame the key goes down.)
