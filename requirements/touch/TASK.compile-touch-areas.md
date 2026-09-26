---
status: done
component: touch
related: [STORY.touch-areas.md, compiler/TASK.runtime-node-table-and-script-services.md, compiler/TASK.compile-scripts-to-c.md]
---

# Task: Compile touch areas and run them on the DS

## Description
- **Translation** (`translate-scene-3d.ts`): every kept TouchArea2D / TouchArea3D becomes a `DsTouchArea` (`ds-scene.ts`): a `rect` (left, top, width, height in
  screen pixels, the sprite's rounding) or a `box` / `sphere` with `params` in 20.12 (half extents, radius). The node table's `touch` field links a node to its
  area (-1 for none); the camera carries `tanHalfFov`. Hidden areas no script names are left out; a named one is kept (hidden, so never touched). Diagnostics:
  `touch-area-unused`, `touch-area-not-touchable`. The writer emits `touchAreas[]`, the count and `tanHalfFov` (`scene.h`: `GsTouchArea`, `GS_TOUCH_*`).
- **Runtime** (`gs_runtime.c`, `gs_update_touch()` once a frame after `gs_read_input()` and before the scripts): per area, is the stylus on it now / last frame. A
  rectangle is a comparison with the touched pixel. A volume is a **ray from the camera through the touched pixel** (`(2 (px + 0.5) / 256 - 1) * tanHalfFov *
  aspect`, `1 - 2 (py + 0.5) / 192` times `tanHalfFov`, `-1`), taken into the shape's own space with the transpose of (view x world) (both rigid) and divided by
  the node's scale, then a slab test for a box or a discriminant test for a sphere; the ray is a half line. It is **soft float** (the ARM9 has no FPU), a few hundred
  operations per volume, and only runs while the stylus is down. `gs_touch_state(node, which)` answers the scripts; released means lifted this frame after being on
  the area the frame before.
- **Order and lag.** The test uses the node and camera transforms of the previous frame's update (scripts run after it), so a volume moved by a script is tested
  where it was drawn.
- 2D projects: the 2D runtime has no scripts, so `translateScene2D` reports a TouchArea2D as `two-d-node-not-built`.

## Acceptance Criteria
See `STORY.touch-areas.md`. Verified on the emulator in `packages/compiler/src/testing/touch-areas.rom.test.ts`; the existing scene-data tests were updated for the
new node field, count and table pointer.
