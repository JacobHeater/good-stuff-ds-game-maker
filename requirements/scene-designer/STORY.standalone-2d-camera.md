---
status: done
component: scene-designer
related: [EPIC.full-2d-games.md, STORY.standalone-2d-scripting.md, STORY.standalone-2d-sound.md, STORY.standalone-2d-collision.md]
---

# Story: Camera2D scrolls a standalone 2D project

## Context
Item 4 of `EPIC.full-2d-games.md`. Every 2D position was fixed screen-space: `Camera2D` existed as a scene-node kind
with no script support and no effect on the runtime. Without a camera, a level can only ever be as big as one screen
-- needed for a platformer or top-down game.

## Decision
- **One active camera per screen, first in tree order wins.** A second `Camera2D` on the same screen compiles with
  a `multiple-cameras` warning (the same "diagnose, don't fail the build" style every other 2D diagnostic uses) and
  simply does nothing, rather than making "which camera is active" itself scriptable (e.g. a `current` flag like
  3D's `Camera3D`) -- no 2D game needs more than one camera per screen yet, and this can be added later without
  breaking anything if it ever does.
- **Every `Sprite2D`/`AnimatedSprite2D` on a screen that has a camera is unconditionally dynamic**, whether or not a
  script ever touches it or the camera -- not just the ones a script reaches. The DS's sprite (OAM) hardware has no
  global scroll register: unlike a tile background layer, there is no hardware shortcut for "shift everything by an
  offset," so every sprite's hardware x/y must be individually repositioned each frame once a camera exists on its
  screen. A two-tier "only dynamic if the camera itself is scripted" design was considered and rejected: it would
  have required threading camera-awareness into `collectSprites`/`collectLabels` (shared with 3D's own 2D-screen
  path), risking a regression there for a savings that only matters once a camera is both present and never moves,
  which is not a real scenario. This reach rule is scoped to exactly the two sprite kinds (and the camera node
  itself) -- a group, `Label`, `CollisionShape2D` or `AudioStreamPlayer` merely sharing a screen with a camera is
  *not* swept in by that alone, since none of those are drawn relative to the camera; they still need a script to
  reach them, exactly as before this story (an early draft of this reach rule applied to every node kind
  regardless of its relationship to the camera, which would have silently given every unscripted `CollisionShape2D`
  defaulting to the same screen a collider and a spurious `collision-shape-unused` warning -- caught and narrowed
  before it shipped).
- **No bounds, no deadzone, no smoothing/follow helper.** A camera is just a position a script can read and write,
  exactly like a sprite's -- the same minimal "overlap detection only, no physics" scoping `STORY.standalone-2d-
  collision.md` used for collision. A script that wants to clamp the camera to a level's edges or ease toward a
  target already can, in script, with ordinary math; building that in is a feature nobody asked for yet.
- **New, narrower `isCameraTarget` rather than widening `isSpriteTarget` further.** `CollisionShape2D` was added to
  `isSpriteTarget` in the collision story because it genuinely has the same four members (position/rotation/scale/
  visible) a sprite does. A `Camera2D` does not: it has `position` only, so it gets its own check with its own,
  smaller member set, rather than exposing `rotation`/`scale`/`visible` on it and hoping nothing uses them.

## Description
- **Checker** (`checker.ts`): `isCameraTarget(target)` (true when every resolved kind is `Camera2D`). `position`
  resolves on a camera (self, named, and member-access) the same way it does on a sprite, but `.z`, `rotation`,
  `scale` and `visible` are rejected. The whole-vector-copy compatibility check (`$A.position = $B.position`) was
  widened from "both sides are sprite-like" to "both sides are 2D (sprite-like or camera-like)," so
  `$Camera.position = $Player.position` -- the ordinary "snap camera to a target" pattern -- type-checks.
- **Compiler** (`translate-scene-2d.ts`): collects each screen's first `Camera2D` in tree order (`cameraByScreen`),
  warning `multiple-cameras` on any extra. A camera always gets a node-table place (its starting position matters
  even if nothing ever moves it). `reachedByCamera` adds `Sprite2D`/`AnimatedSprite2D`/`Camera2D` nodes on a
  camera'd screen to the node table and marks sprites dynamic, without touching the shared `collectSprites`/
  `collectLabels` functions' own logic -- it's purely a wider `reached` predicate feeding the same `live.
  reachedByScript` parameter those functions already took. `topCamera`/`bottomCamera` (each screen's camera's node
  index, or -1) are new top-level `DsScene2D` fields, deliberately *not* inside the shared `DsScreen2D`/`GsScreen2D`
  shape 3D's own 2D screen also uses.
- **Data** (`ds-scene.ts`): `DsScene2D` gained `topCamera: number` and `bottomCamera: number`.
- **Runtime** (`runtime2d/`): `scene2d.h`'s `GsScene2D` gained `topCamera`/`bottomCamera`. `main.c`'s `ScreenState`
  gained `cameraNode`, set by `load_screen` (now taking a `cameraNode` parameter, passed `gs_scene2d.topCamera`/
  `bottomCamera` from `main()`) -- `screens` is `static`, so without an explicit assignment a camera-less screen
  would default to node 0 instead of "none," reading a stray node as if it were a camera. `follow_sprite` now reads
  a sprite's node position relative to its screen's camera (subtracting the camera's own live position from
  `gs_node_state` before rounding to pixels) when `cameraNode >= 0`, otherwise unchanged (absolute position, exactly
  as before this story).

## Notes (built and verified)
- Unit tests: `core/script/script-sprite.test.ts` (new `describe("scripts on a Camera2D", ...)`: moves it via
  `position.x`/`.y` bare, named and with `self`; has no `rotation`/`scale`/`visible`; `position` has `.x`/`.y` only;
  can snap to/from a sprite's position). `compiler/translate-scene-2d.test.ts` (new `describe("camera in a 2D
  project", ...)`: no camera means `topCamera`/`bottomCamera` are both -1; a camera gets a node-table entry and is
  recorded as `topCamera`/`bottomCamera` even unscripted; every sprite on its screen becomes dynamic while one on
  the other screen doesn't, and the root group isn't swept in just for sharing the screen; the `multiple-cameras`
  warning; an unscripted `CollisionShape2D`/`Label` sharing the camera's screen stays untouched (no collider, no
  warning); a script moving the camera compiles). Full fast suite (886 tests across `core`/`compiler`) and
  typecheck pass.
- **Verified with a real devkitARM build**: a project with a scripted `Camera2D` (writing `position.x`/`.y` every
  frame) on the top screen, a `Sprite2D` on that same screen (unscripted, so dynamic only because of the camera),
  and a second `Sprite2D` on the bottom screen (no camera there, stays static) -- compiled and linked with no
  errors.
- **Not verified:** actually running the built ROM (no emulator launch, no `*.rom.test.ts`); the on-screen look of
  scrolling itself. **Not built:** bounds/clamping, a deadzone or follow/smoothing helper, a `current`-style flag
  for more than one camera per screen -- all deliberately out of scope (see Decision above).
