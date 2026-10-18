---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.directional-light-intensity.md]
---

# Story: A SkyBox3D node

## Context
Owner request: "add a new Sky box node where you can set the sky color and more." The DS has no hardware skybox and
no gradient clear color -- every real DS game that has a sky draws it as geometry. Given the choice between a solid
backdrop color, a two-color screen-space gradient, or a true textured skybox mesh, the owner chose the gradient.

## Description
- A new `SkyBox3D` node kind. Its own position/rotation/scale are unused (it's a whole-scene backdrop, not a placed
  object), so the Inspector hides them for it.
- Two colors in the Inspector: **Top color** and **Horizon color** (defaults: `#2f6fb0`, `#cfe9ff`), each a plain
  color swatch, same as a mesh's own color field; and a **Distance** slider, `SKY_BOX_DISTANCE_MIN` (0.5) to
  `SKY_BOX_DISTANCE_MAX` (7.5) scene units (default 4), clamped at both the editor and compile-time boundary.
  Added after the first hardware pass: the gradient's own literal placement started pinned so close to the camera
  that the view distance read as badly, obviously wrong on real hardware -- adjustability fixed it.
- **How it's actually drawn (no hardware gradient clear exists):** a full-screen two-triangle polygon, drawn before
  anything else each frame, with the top color at the top edge and the horizon color at the bottom -- the geometry
  engine interpolates a triangle's own per-vertex color across it for free, no texture or lighting needed. It's drawn
  with an identity modelview (so it never turns with the camera, staying fixed on the screen like a real backdrop)
  but the scene's own real projection, and at alpha 30 (not 31) on purpose: the DS skips writing depth for any
  polygon below full alpha (the same rule a translucent mesh already relies on), so every real polygon drawn
  afterward this frame still depth-tests against the untouched, just-cleared depth buffer and correctly draws over
  it regardless of where in the world it actually is. Replaces the runtime's own flat default backdrop for any scene
  that has one. The polygon's own size (`halfHeight`/`halfWidth` in `draw_sky_box`) scales with **Distance** via
  `tanHalfFov * distance`, so it always exactly fills the screen regardless of where it's literally placed -- how far
  away it sits only matters for staying within a vertex's own v16 (4.12 fixed point) +-8 unit range, which is exactly
  what bounds the slider's own max.
- At most one is used; a scene with more than one warns (`multiple-sky-boxes`) and uses the first in the tree, the
  same rule an extra, unmarked Camera3D already follows.
- Saved as `skyBox: { topColor, horizonColor, distance }` on the node, each optional (a sky box with none saved --
  a brand new one, or one from before a field was touched -- shows the defaults).

## Acceptance Criteria
```gherkin
Scenario: A new sky box starts at the default gradient
  Given a SkyBox3D is added
  Then the Inspector shows Top color #2f6fb0, Horizon color #cfe9ff and Distance 4
  And its position/rotation/scale fields are hidden (they do nothing)

Scenario: Distance is clamped
  Given the Distance slider is dragged past either end
  Then the value stops at 0.5 (nearest) or 7.5 (farthest), never beyond

Scenario: The colors reach the ROM
  Given a sky box with a red top and a blue horizon
  Then the compiled scene's skyBox is { topColor: red as RGB15, horizonColor: blue as RGB15 }

Scenario: It draws correctly on real hardware
  Given the same scene with a cube in front of the camera
  Then the top of the screen reads red, the bottom reads blue, and the cube still draws over the gradient correctly

Scenario: A scene with none compiles exactly as before
  Then compiled scene's skyBox is null and the runtime's own flat default backdrop is used, unchanged

Scenario: More than one sky box warns and uses the first
  Given two SkyBox3D nodes in one scene
  Then a multiple-sky-boxes warning names the first one, and only its colors are used
```

## Notes
- **Built and verified.** Core (`getSkyBox`/`DEFAULT_SKY_BOX`), the Inspector field (position/rotation/scale hidden
  for this kind specifically), the editor-store's `SET_SKY_BOX` action and undo, the persistence schema (`skyBoxData`,
  "#rrggbb" pattern, round-trips), the compiler (`translate-scene-3d.ts`'s `skyBoxes` collection, the
  `multiple-sky-boxes` warning, RGB15 conversion via the same `parseMeshColor` a mesh's own color already uses), and
  the runtime (`draw_sky_box` in `main.c`) -- 13 new unit/schema/compiler tests, full `vitest run` (1398 tests) and
  `tsc --noEmit` clean across every package.
- **Verified on real hardware**, not just reasoned about: a throwaway ROM probe (not committed) built a scene with a
  bright red top / blue horizon sky box and a foreground cube, captured it in melonDS, and read back the actual
  pixels -- top-of-screen (235, 0, 28), bottom-of-screen (24, 0, 235), and the cube's own position (190, 190, 190,
  grey, not a gradient color), confirming both the gradient direction and that real geometry still correctly draws
  over the sky box despite its depth write being skipped. **Distance was verified the same way** after the owner's
  own hardware feedback that the default placement looked far too close: a second probe at a much nearer distance
  value confirmed the gradient still filled the screen correctly and the view read as expected.
- The "skip depth write via alpha < 31" trick means a scene with a sky box pays whatever small per-polygon cost
  `GL_BLEND` adds for every polygon in the scene, not just the sky box's own two triangles (`GL_BLEND` is a
  geometry-engine-wide switch on the DS, not a per-polygon one) -- accepted as a reasonable, minor cost rather than
  toggling the switch twice a frame around just the sky box's own draw.
- **Not built:** a true textured/cubemap skybox (ruled out: DS fill-rate and texture memory, and no real DS game
  does this), a third (middle) gradient stop, and a WYSIWYG preview of the gradient in the editor's own 3D viewport
  (today's viewport background is a fixed dark color regardless of any backdrop setting, sky box included -- this
  doesn't regress anything that worked before, but means the editor doesn't yet show what the ROM will actually look
  like for this specific property).
