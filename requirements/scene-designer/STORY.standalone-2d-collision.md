---
status: done
component: scene-designer
related: [EPIC.full-2d-games.md, STORY.standalone-2d-scripting.md, collision/EPIC.collision-shapes.md, collision/TASK.script-overlaps-check.md]
---

# Story: overlaps() works in a standalone 2D project

## Context
Item 3 of `EPIC.full-2d-games.md`. `CollisionShape2D` and `Area2D` existed only as names in the `SceneNodeKind2D` enum --
no data model, no script support, no runtime. `overlaps()` already existed as a script built-in, but `checker.ts` hard-
required the other shape to be a `CollisionShape3D` (`requireShape`), independent of the generic `"collision"`
capability (which turned out to be declared but never actually read anywhere).

## Decision
- **Overlap detection only, deliberately** -- no `solid` flag, no `move_and_collide`, no floor/wall/ceiling, mirroring
  how 3D's own collision started before `collision/STORY.solid-shapes-and-move-and-collide.md` existed. Solid-body
  movement is real 2D physics work of its own (axis-by-axis sliding resolution against the DS's fixed-point math),
  not a small extension of "do these two shapes overlap right now" -- scoped out of `EPIC.full-2d-games.md` on
  purpose, to build later if wanted.
- **`Area2D` stays untouched.** 3D has no distinct "Area3D" kind either -- `move_and_collide`'s "body" is just "any
  node with collision shapes under it," no special container kind needed. Giving `Area2D` real behavior now would be
  inventing a feature nobody asked for; it remains a plain, inert grouping node, exactly like a `Node2D`.
- **`CollisionShape2D` reuses the exact mechanism `Sprite2D` already has for position/rotation/scale/visible**
  (`checker.ts`'s `isSpriteTarget`/`spriteMember`, widened to include it) rather than a parallel one, since the member
  shape (a vector position/scale, one rotation number, a visible flag) is identical.

## Description
- **Core** (`collision-shape-2d.ts`, new): `CollisionShape2DData { shape: "rect" | "circle", size, radius }`,
  `getCollisionShape2D`/`normalizeCollisionShape2D` -- the same shape as `touch-area.ts`'s `TouchArea2DData` (a close
  precedent: a 2D rect centered on the node's position, already-established clamping style). `SceneNode` gained
  `collision2D?`, the same "separate field per 2D/3D variant" pattern `collision`/`touchArea2D`/`touchArea3D` already
  use. Persistence schema gained `collisionShape2DData` and the `collision2D` property, mirroring `collisionShapeData`.
- **Checker** (`checker.ts`): `requireShape` (what `overlaps()` requires) now accepts `CollisionShape2D` alongside
  `CollisionShape3D`, with both named in its error messages. `isSpriteTarget`/`spriteMember` (Sprite2D's position/
  rotation/scale/visible) now also covers `CollisionShape2D`, so a script can read or move a shape exactly like it
  already could a sprite. `move_and_collide`/`is_on_floor`/etc. are untouched: they're gated by a *different*,
  still-3D-only check (`requireBody`), so widening `overlaps()` didn't also widen those.
- **Compiler** (`translate-scene-2d.ts`): new `collectCollision2D`, giving a collider to every `CollisionShape2D` a
  script actually reaches (already in the node table from `STORY.standalone-2d-scripting.md`'s `scripts.touchedIds`)
  -- one nothing reaches needs no collider and isn't embedded at all. A reachable shape nothing passes to `overlaps()`
  still gets the same `collision-shape-unused` warning a 3D project's does. A rect's full `size` becomes half-extents
  in the collider (`p[0]`/`p[1]`), the same convention a 3D box's `p` already uses.
- **Data** (`ds-scene.ts`): new `DsCollider2D { shape, p: [number, number], node }`; `DsScene2D` gained `colliders`.
- **Runtime** (`runtime2d/`): `scene2d.h` gained `GsCollider2D` and `GsScene2D.colliderCount/colliders`.
  `gs_runtime2d.c` gained the real `gs_overlaps(a, b)`: finds each node's collider by node index (the same
  `collider_of_node` search pattern `find_sprite`/`find_label`/`gs_node_audio_player` already use), reads both
  shapes' *live* position from `gs_node_state` (so a script moving a node moves its collider for free, no extra
  bookkeeping), and runs the matching fixed-point test -- AABB for rect-rect, a squared-distance compare for
  circle-circle, and a clamped-nearest-point test for circle-rect. `gs_stubs2d.c`'s `gs_overlaps` no-op is gone.

## Notes (built and verified)
- Unit tests: `core/script/script-overlaps.test.ts` (new `describe("overlaps() on CollisionShape2D", ...)`: two
  CollisionShape2D nodes by name, `self`, reading/writing position/rotation/scale/visible, the shared error message
  naming both shape kinds for a node that's neither); existing 3D overlaps/collision tests updated for the new
  two-kind error wording. `compiler/translate-scene-2d.test.ts` (new `describe("collision in a 2D project", ...)`:
  two shapes checked with `overlaps()` get a node and a collider each with the right half-extents/radius and
  `gs_overlaps(0, 1)` in the generated code; the `collision-shape-unused` warning; a shape nothing reaches is left
  out of the ROM with no warning at all). Full fast suite (1214 tests) and typecheck pass.
- **Verified with a real devkitARM build**: a project with two `CollisionShape2D` nodes (a rect and a circle) checked
  with `overlaps()` inside the same script already exercising scripting and sound from the earlier two stories --
  compiled and linked with no errors.
- **Not verified:** actually running the built ROM (no emulator launch, no `*.rom.test.ts`); the overlap math itself
  against real gameplay (it's a standard, textbook AABB/circle/clamped-point test, but hasn't been exercised with
  real positions on real hardware). **Not built:** solid shapes, `move_and_collide`, floor/wall/ceiling for 2D (a
  separate, later piece of work if wanted -- see `EPIC.full-2d-games.md`); any special behavior for `Area2D`, which
  remains a plain inert node, same as `Node2D`.
