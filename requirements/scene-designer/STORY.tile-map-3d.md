---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.standalone-2d-tilemaps.md, STORY.sky-box.md]
---

# Story: A TileMap3D node (a 3D tile grid, streamed from the ROM)

## Context
Owner request: a 3D tile-grid node like Godot's GridMap -- paint a palette of mesh "tiles" into a grid by clicking
cells in the 3D viewport, performant enough for an Animal-Crossing-Wild-World-scale world. Two decisions the owner
made explicitly, both the more ambitious option at each fork (see the plan this story was built from,
`keen-greeting-glade.md`): a **full 3D grid** (X/Y/Z, cells can stack vertically), not a flat X/Z floor plan like the
2D `TileMap`; and **true on-demand streaming from the ROM**, not just "load everything, draw only what's near" --
this engine compiles every scene into one static ROM image, so without real streaming a TileMap3D's whole grid would
still have to fit in RAM at once, and runtime culling alone would only cut *drawing* cost, not how large a world can
be.

This is achievable because the toolchain already has full NitroFS support, unused by this engine before this story:
libnds's `nitroFSInit()` and `devkitARM/ds_rules`'s own `NITRO_FILES` variable, which `ndstool` already packs into
the `.nds` file's own NitroFS region at build time.

## Description
- A new `TileMap3D` node kind (`packages/core/src/tile-map-3d.ts`). Its data is a **palette** (each entry an
  imported model, optional texture and color -- the same choices a plain `MeshInstance3D` has) and a **sparse** cell
  map keyed by `"x,y,z"`, since a real painted world is mostly empty space. A cell's rotation is Y-axis (yaw) only,
  in quarter turns (0..3) -- full per-axis orientation is real but rare for tile-grid content, and this engine's own
  rotation conventions elsewhere already favor yaw-only turns. A cell's mesh-local origin sits exactly at its own
  integer `(x, y, z)`: a tile modeled centered on its own origin (the common case) is centered on that grid point,
  matching GridMap's own "cell center at the integer" convention, not Minecraft's "cell spans `[n, n+1)`" one.
- **Chunking**: cells are grouped into `8x8x8`-cell chunks (`TILE_MAP_3D_CHUNK_SIZE`). The compiler
  (`translate-tile-map-3d.ts`) writes one dense binary file per **non-empty** chunk only (2 bytes a cell: palette
  index + 1, 0 = empty, then rotation) via the build pipeline's new `nitroFiles` option (`rom-builder.ts`,
  `ports.ts`), keyed by a path baked in at compile time (`tile3d/<sceneIndex>/<tileMapIndexInScene>/<cx>_<cy>_<cz>.bin`)
  -- not compiled in as C data, so loading one later never means the whole grid was ever resident. The palette's own
  meshes/textures compile exactly like any other imported mesh/texture (the same deduplicated tables a plain
  `MeshInstance3D` already uses): only the *cell grid* is chunked and streamed, not the tile geometry itself.
- **Runtime streaming** (`main.c`): a fixed `3x3x3` window of loaded chunks per `TileMap3D` node, recentred on the
  camera's own position (converted into the node's own local grid space, accounting for its rotation and scale) only
  when the camera actually crosses into a different chunk -- an occasional check, not a per-frame cost beyond one
  integer compare. A chunk already in the window when it's recentred is kept, not reloaded; a newly-needed chunk is
  `fopen`/`fread` from the ROM's own NitroFS region, or left all-zero (empty) if that chunk was never painted (so it
  has no file at all -- the ordinary case for most of a sparse world). Drawing reuses the same per-instance material/
  vertex path a plain mesh already goes through, just translated to each cell's own position and turned by its yaw.
- **The editor** (Phase 4): a Paint tool (toolbar, key `T`), active only while a `TileMap3D` is selected. The
  Inspector's palette field (`TileMap3DField.tsx`) adds/removes/edits palette entries (model, optional texture and
  color) and picks the active brush and its rotation. In the 3D viewport (`TileMap3DPaintController`, native pointer
  events on the canvas -- the same technique `BoxSelectController` uses, and for the same reason: `OrbitControls`
  still needs to own every other drag), clicking an existing cell's own face places the brush beside it (nudging the
  hit point half a grid-local unit along the face's own world normal, converted into the node's own local space, so
  it's correct regardless of the node's rotation or scale); Shift+click erases that cell; clicking empty space hits a
  large, faint ground-plane fallback at the node's own local y = 0, the same convention Godot's GridMap editor uses.
  The invisible pickers a click can land on are sized to each palette entry's own actual mesh bounds
  (`boundsOf` in `Viewport3D.tsx`), not a fixed unit cube -- a palette tile is rarely an exact 1x1x1 box, and a picker
  smaller than what's actually drawn there would miss most real clicks.

## Acceptance Criteria
```gherkin
Scenario: A new TileMap3D starts empty
  Given a TileMap3D is added
  Then its palette and cells are both empty, and nothing is saved for it until it's edited

Scenario: Painting and erasing
  Given a TileMap3D with one palette entry, and the Paint tool active
  When a cell's face is clicked, the brush is placed in the adjacent cell
  And when that cell is Shift+clicked, it is erased

Scenario: Only non-empty chunks reach the ROM
  Given a TileMap3D with cells painted far apart (different chunks)
  Then the compiled scene writes one NitroFS file per occupied chunk, and none for the empty ones in between

Scenario: A missing palette model doesn't crash the compiler
  Given a palette entry naming a model the project doesn't have
  Then a tile-map-3d-missing-model diagnostic is reported (an error, so the scene fails to compile, the same as a
    plain MeshInstance3D's own missing model) rather than the compiler throwing

Scenario: The runtime streams, not loads everything
  Given a grid painted far larger than any one frame could draw, with cells in two widely separated chunks
  Then only the chunk(s) within the camera's own 3x3x3 window are ever read from the ROM or drawn
  And as the camera moves into a different chunk's range, that chunk is streamed in and the old one evicted

Scenario: A palette-only model survives save
  Given a mesh no MeshInstance3D uses, only a TileMap3D's own palette
  Then saving the project keeps that mesh (and any palette-only texture) in the file, not pruned as unused
```

## Notes
- **Built and verified, in four phases, each checkpointed on real hardware or a real running app before the next:**
  1. **NitroFS plumbing** (`Makefile`'s `NITRO_FILES`, `rom-builder.ts`'s `nitroFiles` option, `nitroFSInit()` in
     `main.c`) -- a real ROM boot proved a hand-written NitroFS file round-trips through `fopen`/`fread` before
     anything else depended on it.
  2. **Data model and compiler chunking** (`tile-map-3d.ts`, `translate-tile-map-3d.ts`, `scene.h`'s `GsTileMap3D`/
     `GsTileMap3DPaletteEntry`) -- unit/schema tests only (nothing runs on hardware yet at this phase).
  3. **Runtime streaming and drawing** (`main.c`'s `tm3d_refresh`/`tm3d_draw_node`) -- hardware-verified on real
     melonDS (`tile-map-3d.rom.test.ts`): a cell at the camera's own starting look-at point renders immediately; a
     second cell 45 units (several chunk boundaries) away does not render until a script moves the camera there
     *while the ROM is already running*, proving the stream-in/evict cycle happens live, not just at scene start.
  4. **The editor** -- unit tests for the new editor-store actions (`SET_TILE_MAP_3D_PALETTE`, `PAINT_TILE_3D`,
     `ERASE_TILE_3D`, the brush's own non-undoable `SET_TILE_MAP_3D_BRUSH`), plus a real pass in the running Electron
     app (`tests/prototypes/e2e/tile-map-3d.mjs`): imported a model, built a one-tile palette from the Inspector,
     switched to the Paint tool, and confirmed by reading the *saved project file* after each step that a ground-
     plane click paints a cell, clicking that cell's own face paints a second, adjacent one (not the same cell
     again), and Shift+click erases one.
  - Full `vitest run` and `tsc --noEmit` clean across every package after each phase, not just at the end.
- **Two real bugs this story's own E2E pass caught, that unit tests alone could not have** (the reason the
  established discipline of actually running the app, not just reasoning about the code, mattered here same as it
  did for the skinning matrix layout and the view-matrix discard earlier in this engine's history):
  - The invisible click-pickers (`TileMap3DPaintController`'s own cell/ground-plane meshes) had no R3F pointer
    handler of their own, so React Three Fiber's synthetic event system treated every paint click as a miss on the
    canvas and fired `Canvas`'s own `onPointerMissed`, deselecting the TileMap3D right after the very first paint --
    breaking continued painting for everyone, not just the test. Fixed with a no-op `onPointerDown` that only calls
    `event.stopPropagation()`.
  - `pruneUnusedAssets` (run on every save) never looked at a `TileMap3D`'s own palette at all, so a model or
    texture used *only* by a palette entry -- the normal case, since the whole point of painting a grid is not
    needing a separate `MeshInstance3D` for every tile -- was silently dropped from the project file on save,
    leaving the palette with a dangling reference. Fixed in `project-snapshot.ts`'s `pruneUnusedAssets`.
- **Not built** (explicitly out of scope from the start): per-axis tile rotation beyond Y/yaw; collision for painted
  tiles (a real, separate follow-up -- likely each palette tile optionally carrying its own `CollisionShape3D`
  template); and editing the grid from a running script (this story is editor-time authoring only, streamed at play
  time, not a runtime-mutable world).
