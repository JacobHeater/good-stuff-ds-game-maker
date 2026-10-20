---
status: done
component: scene-designer
related: [STORY.tile-map-3d.md, STORY.standalone-2d-tilemaps.md]
---

# Story: TileMap3D's own solid tiles (a checkbox, queried from script)

## Context
TileMap3D shipped with zero collision (`STORY.tile-map-3d.md`'s own "Not built" list) -- building the
island-survival example game surfaced this directly, needing a separate, hand-authored invisible `CollisionShape3D`
floor just to give the player something to stand on. Owner asked for "tiles should be able to have a solid
collision checkbox," and chose (offered a choice between an explicit script query, mirroring the 2D TileMap's own
already-shipped `tile_solid()`, versus automatic collision folded into `move_and_collide`/`ray_cast`) the explicit
query -- lower risk, and sidesteps the hard problem of what a body outside TileMap3D's own streamed chunk window
should collide against at all.

## Description
- **Data model** (`packages/core/src/tile-map-3d.ts`): `solid?: boolean` on `TileMap3DPaletteEntry` itself (the
  palette entry is already TileMap3D's own "one entry per tile type" structure, unlike the 2D TileMap's
  sheet-frame-index scheme, which needed a separate parallel array). `isTileSolid3D(entry)` is the one place
  "absent means not solid" is decided.
- **Compiled wire format**: `DsTileMap3DPaletteEntry`/`GsTileMap3DPaletteEntry` gained a `solid` field, threaded
  through `translate-tile-map-3d.ts` and `scene-data-writer.ts`, same shape as `primitive`/`texture`/`diffuse`.
- **Runtime, and a real structural prerequisite**: TileMap3D's own chunk-streaming state (`Tm3dSlot`, `tm3d_slots`,
  `tm3d_init`/`tm3d_load`/`tm3d_refresh`/`tm3d_world_to_local`) lived entirely inside `main.c` as file-local
  `static`s -- the one subsystem never split into its own `gs_*.c`/`.h` pair the way collision/inventory/spawn pools
  already are, because until now nothing outside `main.c`'s own render loop needed to reach it. Extracted into new
  `gs_tile_map_3d.c`/`gs_tile_map_3d.h` (verbatim move; `main.c` keeps only the GL-specific `tm3d_draw_node`/
  `draw_tile_maps_3d`), so the new `gs_tile_solid_3d(node, x, y, z)` query -- and the hardware-test harness, which
  replaces `main.c` wholesale -- can both reach it. `gs_tile_solid_3d` converts the world position to the
  TileMap3D's own local space (reusing `tm3d_world_to_local`), floors to a chunk coordinate the same way
  `tm3d_refresh` already does, linear-scans that node's own loaded-chunk window for a match, decodes the cell's raw
  byte, and returns its palette entry's own `solid` flag -- 0 for no such node, an unpainted cell, or (the one real,
  documented limitation this has that an ordinary `CollisionShape3D`/the 2D TileMap's own query never does) a chunk
  currently outside the runtime's streamed 3x3x3 window around the camera. A second, smaller limitation: that
  window only recenters once a frame, in the render pass (after scripts run), so a query reflects the *previous*
  frame's camera position.
- **Script API**: a wholly separate builtin, `tile_solid_3d(x, y, z)` (not a mode-varying signature sharing
  `tile_solid`'s name -- `TileMap`/`TileMap3D` are already distinct node kinds, unlike `spawn()`'s own deliberate,
  singular exception for an argument count that varies by project mode). `checkTileSolid3D`/`requireTileMap3D` in
  `checker.ts` mirror `checkTileSolid`/`requireTileMap` line for line; `ast.ts` gained a `tileSolid3DCall`
  Resolution variant; `completion.ts` gained a `tileMap3D` capability; `script-codegen.ts` emits
  `gs_tile_solid_3d(...)`, with x/y/z as floats (position arguments, following `move_and_collide`/`ray_cast`'s own
  convention, not Inventory's int-forcing one).
- **Editor**: a "Solid" checkbox on each palette entry's own row in `TileMap3DField.tsx`, wired through the field's
  already-existing generic `updateEntry`/`setTileMap3DPalette` whole-array-replace action (no new editor-store
  action needed) -- the same `title="Solid ground"` checkbox the 2D TileMap's own `TileMapField.tsx` already has.

## Acceptance Criteria
```gherkin
Scenario: A solid palette entry's own painted cells read solid
  Given a TileMap3D palette entry marked Solid, painted at a cell within the runtime's own loaded chunk window
  When a script calls tile_solid_3d(x, y, z) at that cell's own world position
  Then it returns true

Scenario: A non-solid entry, and an unpainted cell, both read not solid
  Given a palette entry not marked Solid, or a cell nothing is painted on
  Then tile_solid_3d() at that position returns false

Scenario: A solid tile outside the streamed window reads not solid, not "unknown"
  Given a solid tile painted in a chunk the runtime hasn't currently loaded (far from the camera)
  Then tile_solid_3d() at that position returns false, same as an unpainted cell would
  When the camera (and so the loaded window) moves near it instead
  Then the same query now returns true

Scenario: Naming a non-TileMap3D node is a checker error
  Given a script calls $Something.tile_solid_3d(x, y, z) where Something isn't a TileMap3D
  Then it's a compile error naming the real kind and what to do instead
```

## Notes
- **A real bug in the hardware-test harness itself, caught while building this story's own permanent test, not a
  unit test**: `runDump` (`packages/compiler/src/testing/framebuffer-dump.ts`), the CPU-exact test harness this
  session's own `coin-game.rom.test.ts`/`spawn-pools.rom.test.ts`/`island-survival.rom.test.ts` all already use,
  generates its own minimal `main()` for evaluating C expressions directly -- and never called `nitroFSInit()`,
  because nothing tested through it before this story ever needed to read a file. Every chunk load (`tm3d_load`'s
  own `fopen("nitro:/...")`) silently failed, leaving every queried cell reading as empty/not-solid regardless of
  what was actually painted -- compiled chunk data confirmed correct on the TypeScript side, runtime reads
  confirmed wrong, isolating the harness itself as the gap. Fixed by adding `nitroFSInit(NULL)` (and
  `#include <filesystem.h>`) to `dumpMainC`'s generated `main()`, the same unconditional call the real runtime's
  own `main.c` already makes ("always... so nitro:/... paths just fail an fopen() harmlessly instead of needing a
  feature flag") -- harmless for every other dump-based test, confirmed by rerunning `coin-game.rom.test.ts` (20
  cases, still passing) after the change.
- **Hardware verification**: `packages/compiler/src/testing/tile-map-3d-solid.rom.test.ts` (permanent), via
  `runDump`, not melonDS pixel capture -- the query itself returns a value, read directly, no screenshot needed.
  A new fixture, `tileMap3DSolidProject` (`packages/compiler/src/fixtures.ts`): two palette entries (one solid, one
  not) and three painted cells -- one of each near the grid's own origin, and a third, solid one far enough away
  (chunk 12) to fall outside the default-loaded window. 5 cases, all passing: the solid tile reads solid; the
  non-solid tile and an unpainted cell both read not solid; the far solid tile reads not solid while the window is
  centered near the origin, locking in the documented streaming limitation; and reads solid once the window is
  recentered near it instead (`tm3d_refresh` called again with a camera position near the far tile).
- **Compiler-level verification**: `packages/compiler/src/tile-map-3d.test.ts` -- two palette entries' own `solid`
  flags compile correctly with no leak between them; a script's `tile_solid_3d(x, y, z)` compiles to
  `gs_tile_solid_3d(...)`.
- **Script-level verification**: new `packages/core/src/script/script-tilemap-3d.test.ts` (9 tests), a close mirror
  of `script-tilemap.test.ts`'s own 9: argument count/type, member-call resolution and its AST annotation, the
  self-attached form (bare and `self.`), the non-TileMap3D-target error, being usable as a `bool`, the
  must-be-called/reserved-name errors, and no error cascade when the named node doesn't exist.
- **A real devkitARM build of the split runtime tree**, confirming `gs_tile_map_3d.c`/`main.c`'s own trim compile
  cleanly together (zero warnings beyond one pre-existing, unrelated `gs_collision.c` warning already on `main`).
- **Not built**: automatic collision (folded into `move_and_collide`/`ray_cast`, so a solid tile blocks movement
  without a script asking) -- deliberately deferred as a separate, larger follow-up; per-entry alpha/unlit tiles
  (unrelated, pre-existing TileMap3D gaps); any change to the runtime's own streamed-window size or recenter timing
  (both pre-existing TileMap3D behavior, just newly documented as limitations of this specific query).
