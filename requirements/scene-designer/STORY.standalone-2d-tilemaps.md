---
status: done
component: scene-designer
related: [EPIC.full-2d-games.md, STORY.standalone-2d-scripting.md, STORY.standalone-2d-sound.md, STORY.standalone-2d-collision.md, STORY.standalone-2d-camera.md, STORY.dual-screen-2d-viewport.md]
---

# Story: TileMap draws and scrolls in a standalone 2D project

## Context
Item 5 of `EPIC.full-2d-games.md`, and the last of the four things asked for in "lets add tilemaps, sound, collision
and camera now" (sound, collision and camera landed first, in that order, since tilemaps needed a camera to scroll
against and -- per the epic's own note -- "a real design spike is needed before this is built"). Before this story,
`TileMap` was a reserved `SceneNodeKind` with no data model, import pipeline, rendering or collision behind it --
the compiler's `two-d-node-not-built` warning was the only thing that knew the name.

## Decision
- **A tile sheet is an ordinary imported sprite sheet, reused wholesale.** `getSpriteFrames`/`getSpriteFramePixels`
  (`imported-sprite.ts`) already read an arbitrary grid of equal frames, read left to right top to bottom -- exactly
  a tileset's own layout. Rather than a new `ImportedTileset` asset type and a parallel import pipeline, a TileMap's
  sheet is a plain `ImportedSprite` with an 8 x 8 frame size, imported through the *exact same* `importSprite`
  action an `AnimatedSprite2D`'s sheet already uses (`frame: { width: 8, height: 8 }`); the only new editor code is
  widening the `IMPORT_SPRITE` reducer case to recognize a `TileMap` target. A `CollisionShape2D`-sized or
  `ImportedTileset`-sized new concept was considered and rejected as pure duplication.
- **8 x 8 tiles, fixed -- not a chosen size.** The DS background hardware's own character tile granularity is always
  8 x 8; there is no "choose a tile size" the way `AnimatedSprite2D`'s frame size is chosen, because anything else
  would need extra reslicing work the hardware doesn't.
- **4bpp, 15 colors plus transparent -- a real, lower hardware ceiling than a sprite's, not a simplification.** A
  sprite gets its own independent 255-color extended palette (`VRAM_F/I_..._EXT_PALETTE`); the background layer this
  draws with reads one of the DS's 16 *shared* 16-color sub-palettes instead (extended BG palette mode was
  considered -- it would give 255 colors like a sprite, but only one bank on the whole chip (`VRAM_H`) can provide
  it for the *sub* engine, and that bank is also the sub screen's label console's only option, so there's no bank
  left for it there; plain 4bpp, with a palette bank reserved away from the console's own colors, works
  identically on both screens and needed no register-level palette-mode code to get right).
- **One tile layer a screen -- not one a TileMap node.** The runtime has exactly one spare background layer a
  screen to spend on this (BG1; BG0 is the label console). A second `TileMap` on the same screen gets a
  `multiple-tilemaps` warning and does nothing, the same shape of rule (and the same reason -- one piece of
  hardware, first in tree order wins) `multiple-cameras` already uses.
- **`tile_solid(x, y)` is the only thing a script can ask -- no collision resolution.** Mirrors `STORY.standalone-
  2d-collision.md`'s own "overlap detection only" scoping: a script already has `position.x`/`.y` and ordinary math,
  so building in floor detection or move-and-slide against a tile grid would be real platformer physics of its own,
  not a small extension of "is this one tile solid." `solid` is indexed by *sheet frame*, not by cell, so painting
  the same ground tile into a hundred cells only ever needs marking solid once.
- **Rendering lives in a new `gs_tilemap.h`, not inside `main.c` or `gs_runtime2d.c`.** Same self-contained-header
  shape as `gs_labels.h`/`gs_sprite_anim.h` -- VRAM upload and per-frame scrolling in one place, `#include`d by
  whichever `.c` file needs it. `gs_tile_solid` itself (the only part a script calls) lives in `gs_runtime2d.c`,
  alongside `gs_overlaps`/`collider_of_node`, since it is a read-only query, not a rendering concern.
- **Deliberately not in the shared `DsScreen2D`/`GsScreen2D`.** A 3D project's own 2D screen can draw a `TileMap`
  node today too, but only as a `two-d-node-not-built` warning -- out of scope here, same as every other item in
  this epic. `DsTileMap`/`GsTileMap` are new top-level arrays on `DsScene2D`/`GsScene2D`, exactly how `topCamera`/
  `bottomCamera`/`colliders` were kept separate from the 3D-shared types, so this story carries zero risk of
  changing what a 3D project's 2D screen does.
- **Basic paint UI in the Inspector, not the 2D viewport.** The dual-screen viewport (`DualScreenViewport.tsx`)
  already only draws a handful of visual kinds as markers (`STORY.dual-screen-2d-viewport.md`'s own notes already
  say `TileMap` isn't one of them); adding a live, camera-aware, scrollable tile-grid overlay *there* is real
  viewport work of its own (`EPIC.full-2d-games.md` already calls viewport polish its own, lower-priority, later
  item). A dedicated grid-and-palette editor inside the Inspector -- click a tile to pick it as the brush, drag to
  paint, a checkbox per sheet tile for `tile_solid()` -- needed no viewport changes and is enough to actually author
  a map without hand-editing JSON.

## Description
- **Core** (`tile-map.ts`, new): `TileMapData { spriteId?, columns, rows, tiles: number[], solid: boolean[] }` --
  `tiles` is `columns * rows` sheet-frame indices or -1 for empty, `solid` one flag a sheet frame (not a cell).
  `getTileMap`/`normalizeTileMap` (defaults, clamped 1..32 each axis, `tiles` padded/truncated to match -- the
  established `collision-shape-2d.ts` pattern), plus `resizeTileMapGrid` (keeps each existing cell at its own
  column/row when the grid is resized) and `tileAt`/`isTileSolid`/`setTileSolid` for the Inspector. `SceneNode`
  gained `tileMap?: Partial<TileMapData>`. Persistence schema gained `tileMapData` and the `tileMap` property.
- **Checker** (`checker.ts`): `tile_solid(x, y)` is a new built-in, the same two-target shape (bare for `self`,
  `$Name.tile_solid(...)` for another node) `overlaps()` already has, gated by a new `requireTileMap` (parallel to
  `requireShape`) instead of widening an existing one -- a `TileMap` has nothing in common with a sprite or shape's
  member set. `completion.ts` also gained a `tileMap` capability flag (and, found and fixed along the way: a
  `shape2D` flag -- `CollisionShape2D`'s `overlaps()` had never been offered by autocomplete at all since the
  collision story landed, because the one `shape` flag it reused there also drives 3D's `body`/`move_and_collide`
  gating, which a 2D shape must never get).
- **Compiler** (`translate-scene-2d.ts`): `collectTileMaps` -- one TileMap a screen (tree order decides which, like
  cameras), nibble-packs each sheet frame into the DS's 4bpp tile format (`packNibbleTile`), reserves physical tile
  0 as an always-blank transparent tile (so an empty cell just points at it, with no special-casing at draw time),
  and validates the sheet's frame size (8 x 8), color count (15) and tile count (511, a whole 16 KB character
  block) -- each a real hardware ceiling, each its own diagnostic (`tileset-wrong-frame-size`, `tileset-too-many-
  colors`, `tileset-too-many-tiles`) rather than a silent truncation. `reachedByCamera` (`STORY.standalone-2d-
  camera.md`) widened to include `TileMap`, so a map's node is in the table -- and its scroll kept live -- whenever
  its screen has a camera, the same as a sprite.
- **Data** (`ds-scene.ts`): new `DsTileMap`; `DsScene2D` gained `tileMaps: DsTileMap[]`.
- **Runtime** (`runtime2d/`): `scene2d.h` gained `GsTileMap` and `GsScene2D.tileMapCount/tileMaps`. New
  `gs_tilemap.h`: `gs_tilemap_start` (uploads tiles/palette/cells to `BgType_Text4bpp`/`BgSize_T_256x256` on BG1,
  charBase 2, mapBase 24, sub-palette bank 15 -- offsets chosen so a screen's label console, BG0/charBase 0/
  mapBase 8, never overlaps it in VRAM or in the shared 4bpp palette), `gs_tilemap_update` (scrolls to the map's
  live node position minus its screen's camera's, the same subtraction `follow_sprite` already does), and
  `gs_tilemap_solid` (the actual lookup, read by `gs_tile_solid` in `gs_runtime2d.c`). `main.c`'s VRAM bank
  selection: the main engine's label and TileMap always share bank A (128 KB, room for both); the sub engine's
  label-sized bank H (32 KB) isn't big enough for both at once, so a TileMap on the bottom screen takes over the
  otherwise-unused bank C (128 KB) instead, moving the bottom label into it too, at its own usual offsets -- a real
  VRAM-budget asymmetry between the two engines' background memory, not an oversight.

## Notes (built and verified)
- Unit tests: `core/tile-map.test.ts` (new: defaults, clamped resize, `tileAt`, `isTileSolid`/`setTileSolid`, and a
  real bug caught here -- `setTileSolid` originally always returned a new object even when the flag was already
  effectively what was asked for, which would have logged a spurious undo step and a spurious "edit" every time a
  tile already not marked solid was set to "not solid" again; fixed to compare first). `core/script/script-
  tilemap.test.ts` (new, mirroring `script-overlaps.test.ts`'s structure exactly: named/self/bare forms, the wrong-
  kind error, arg-count and arg-type errors, the bool-result check, the built-in-name check). `compiler/translate-
  scene-2d.test.ts` (new `describe("tile maps", ...)`: a sheet compiles into packed tiles/cells/solid with the
  reserved blank; no sheet chosen warns and draws nothing; a missing sheet, a non-8x8 frame size, more than 15
  colors and more than 511 tiles each error with their own code; `multiple-tilemaps`; a script-reached map gets a
  node index and `gs_tile_solid(...)` appears in the generated code; a map on a camera'd screen is reached while
  one on a camera-less screen isn't). `ui/state/tilemap-edits.test.ts` (new: import onto a TileMap keeps its grid,
  `SET_TILE_MAP`/`PAINT_TILE`/`SET_TILE_SOLID`, out-of-range and no-op cases, undo, duplication keeps the grid).
  `persistence/json/tilemap-schema.test.ts` (new: round-trip, defaults, out-of-range columns/rows/tile index).
  Full 1263-test fast suite and typecheck across every touched package pass.
- **Verified with two real devkitARM builds**: (1) a scripted `Camera2D`, a `Sprite2D` and a `TileMap` together on
  the top screen, with the player's own script calling `$Level.tile_solid(position.x, position.y)` -- compiled and
  linked with no errors. (2) the riskiest VRAM path this story's design relies on: a `Label` *and* a `TileMap*`
  together on *both* screens at once (forcing the bottom screen's label onto bank C alongside its TileMap) --
  compiled and linked with no errors or warnings.
- **Not verified:** actually running either built ROM (no emulator launch, no `*.rom.test.ts`) -- in particular,
  the exact VRAM byte offsets, the 4bpp palette-bank choice, and the background scroll math are reasoned from the
  DS's documented hardware behavior and confirmed against libnds's own headers, but never seen drawing on real
  hardware or in an emulator. **Not built:** more than one tile layer a screen, a tile bigger than one background
  screen's worth (32 x 32 tiles / 256 x 256 pixels -- the hardware wraps past that, rather than scrolling into a
  second map block), solid-body collision resolution against the grid (deliberately out of scope, see Decision),
  and any viewport-canvas rendering of a TileMap (the Inspector's own paint grid is this story's whole editor UI).
