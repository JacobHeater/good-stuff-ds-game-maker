---
status: in-progress
component: touch
related: [TASK.touch-area-editor.md, TASK.script-touch-area-queries.md, TASK.compile-touch-areas.md, scripting/STORY.write-and-run-scripts.md, collision/EPIC.collision-shapes.md, scene-designer/STORY.choose-2d-screen-in-3d-project.md]
---

# Story: Touch areas (TouchArea2D and TouchArea3D)

## Context
Scripts could read the stylus (`Input.is_touching()`, `touch_x()`, `touch_y()`) but had to compare the coordinates with their own numbers, and had no way to
ask "is the stylus on that object". A touch area is a node that answers that question, the way a collision shape answers `overlaps()`.

## Decisions (made with the product owner)
- **TouchArea2D: a rectangle on the touch screen.** `width` x `height` in screen pixels (default 64 x 64, at most 256 x 192), centered on the node's
  `position` (as a sprite is). Scripts **ask each frame**, no events. Only the bottom screen senses touch.
- **TouchArea3D: a ray-picked volume.** A box or sphere in the 3D scene. When the stylus touches the screen showing the 3D view, a ray from the camera
  through that point is tested against the volume, so a 3D object can be touched. It needs the 3D engine on the bottom screen.
- **Scope: editor, scripts and ROM**, verified with a real stylus in the emulator.

Choices I made without asking (say if any is wrong):
- **Script API** (on either kind, `$Name.` or bare on the node itself): `is_touched()` (the stylus is on it now), `is_touch_pressed()` (it went down on it this
  frame; true for one frame however long it is held), `is_touch_released()` (it was lifted this frame, having been on the area the frame before; dragging the
  stylus out of the area while still touching is not a release). Mirrors `Input.is_button_down / pressed / released`.
- **A 3D volume ignores what is in front of it** (no occlusion by meshes), like a physics pick in Godot; it is hit if the ray passes through it. The ray is a half
  line, so a volume behind the camera is not hit.
- **A hidden touch area is never touched.** A TouchArea3D's size follows its node's scale and its parents' (as a collision shape's does), and its node can be
  moved, rotated and scaled by a script; a TouchArea2D is static (2D nodes can't be scripted).
- **Diagnostics** (warnings, the build goes ahead): `touch-area-unused` (no script asks it), `touch-area-not-touchable` (a TouchArea2D on the top screen, or a
  TouchArea3D while the 3D scene is on the top screen), `two-d-node-not-built` for a TouchArea2D in a 2D project.

## One touch, one area
A touch **belongs to one touch area**: when the stylus goes down, the **nearest volume under it** (the smallest depth along the camera ray) becomes the owner; among 2D rectangles the last
one in the tree (drawn on top) does. The touch stays with that area until the stylus is lifted, so only one of several overlapping blocks is picked up, and a dragged block is not lost to
another that ends up nearer. Only the owner reports `is_touched()`; `is_touch_pressed()` is true only on the first frame of the touch (sliding onto an area later is not a press). A touch
that goes down on no area owns nothing, and then any area it slides over reports it as held (as before). Verified on the emulator: two volumes on the same ray, only the nearer one is pressed.
The emulator tests for rectangles, one volume, scale and sphere were not re-run after this change.

## What works where
| Project | TouchArea2D | TouchArea3D |
| --- | --- | --- |
| 3D project, 3D on the top screen (the default) | works, on the 2D (bottom) screen | can't be touched (warns) |
| 3D project, 3D on the bottom screen | can't be touched (the 2D screen is the top) | works |
| 2D project | **does nothing**: the 2D ROM doesn't run scripts yet (warns) | not available |

## Acceptance Criteria
```gherkin
Scenario: The nodes exist in the editor
  Given a 2D project, then Scene > Add 2D Node lists TouchArea2D and no TouchArea3D
  And in a 3D project Scene > Add 3D Node lists TouchArea3D and Add 2D Node lists TouchArea2D

Scenario: A script asks a touch area
  Given a script with "if $Button.is_touched():"
  Then it checks when $Button is a TouchArea2D or TouchArea3D and is refused, naming the node, when it is anything else

Scenario: A rectangle answers the stylus
  Given a TouchArea2D covering x 160..223, y 24..71 on the bottom screen
  When the stylus touches inside it, then is_touched() is true
  And when it touches outside it, then is_touched() is false

Scenario: A press counts once
  When the stylus is held down on the area for two seconds, then is_touch_pressed() was true for exactly one frame

Scenario: A 3D volume is picked by a ray from the camera
  Given the 3D scene on the bottom screen and a TouchArea3D box at the origin
  When the stylus touches the pixel where the origin is seen, then it is touched
  And when it touches empty screen beside it, then it is not

Scenario: The volume follows its scale
  Given a 1 x 1 x 1 box scaled 3 times along X
  Then it is hit where the unscaled box is not, and missed beyond its stretched size
```

## Verification
Unit tests: `touch-area.test.ts` and `script/script-touch.test.ts` (core), `touch-area-schema.test.ts` (persistence), `touch-areas.test.ts` (compiler),
`touch-area-edits.test.ts` (editor store). Emulator: `packages/compiler/src/testing/touch-areas.rom.test.ts` (real stylus clicks in melonDS; the expected
place of a 3D point on the screen comes from three.js, independently of the DS's ray math).

## Dragging a 3D object
`Input.touch_ground_x(height)` / `touch_ground_z(height)` return the world point on the flat plane at `height` that the stylus points at (the touch ray met with the
plane). A script picks an object up when `$Area.is_touch_pressed()` (remembering where on the object the stylus took hold), and while `Input.is_touching()` moves it toward
that point with `move_and_collide`, so it is stopped by solid shapes and a fast flick can't pass through them. Example: `tests/prototypes/scripts/jenga-block.gsscript`
(the TouchArea3D is a child of the block so it moves with it). Verified on the emulator by touching where three.js says a world point projects and checking the cube goes there.
Runtime: `gs_touch_ground` in `gs_runtime.c` (soft float, ray = camera position and `R^T d`, plane `y = height`).

## Not built
`is_touch_released()` is not exercised on the emulator (the input tool holds a touch while the picture is taken); touch in **2D projects** (needs scripts in the 2D
runtime); occlusion, layers or "topmost only" between overlapping areas; touch position inside the area (`local_x`); capsule/cylinder/mesh-shaped 3D areas;
dragging (position while held); separate icons for the two kinds (both use the same drawn hand).
