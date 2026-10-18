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
  color swatch, same as a mesh's own color field. (An earlier version also had a **Distance** slider; see "How it's
  actually drawn" below for why that turned out not to be a real control at all, and was removed.)
- **How it's actually drawn (no hardware gradient clear exists):** a full-screen two-triangle polygon, drawn before
  anything else each frame, with the top color at the top edge and the horizon color at the bottom -- the geometry
  engine interpolates a triangle's own per-vertex color across it for free, no texture or lighting needed. Drawn
  with an identity modelview (so it never turns with the camera, staying fixed on the screen like a real backdrop)
  and at alpha 30 (not 31), and placed **just inside the camera's own real far plane** (`gs_scene.farPlane * 0.99`),
  not at some small, separately-tunable "distance" -- see the dedicated note below on why an earlier version placed
  it a few scene units out instead, and why that was a real, hardware-confirmed bug. The quad's own screen-filling
  size (`halfHeight`/`halfWidth` in `draw_sky_box`) is computed from that same far-plane distance via
  `tanHalfFov * distance`, so it always exactly fills the screen regardless of how far the far plane itself is set.
  A v16 vertex can only reach about +-8 units, nowhere near a far plane that can be up to `CAMERA_FAR_PLANE_MAX`
  (1000, `scene-node.ts`) -- so the polygon's own local vertices stay a small, fixed unit square, and the actual
  distance is carried entirely by the modelview matrix's own translation (full 20.12 fixed-point precision, the
  same way any ordinary mesh's own world position reaches arbitrarily far from a small, local vertex buffer).
- **A scene can have more than one SkyBox3D** -- the way to build a day/night (or weather, or any similar) cycle:
  add one node per sky (e.g. "Day", "Night"), each its own colors, and a script switches between them by toggling
  each one's own ordinary node visibility (`$Night.visible = true`, exactly like any other node), the same way a
  script already shows or hides anything else. There is no dedicated runtime API for this and none was added: the
  runtime draws whichever SkyBox3D is visible (the first, in compiled order, if more than one happens to be at
  once), and the flat default backdrop when none are. A **Current** checkbox in the Inspector marks which one is
  the scene's own *default* -- before any script has touched visibility, and which one the compiler puts first (so
  a moment with more than one visible still draws a consistent one) -- with no mark, the first SkyBox3D in the
  scene's own tree is the default, the same fallback Camera3D's own current uses. Marking it does not itself show
  or hide anything; only each sky box's own `visible` does that.
- Saved as `skyBox: { topColor, horizonColor, current }` on the node (plus a vestigial `distance` key a pre-fix
  project file may still have -- accepted and ignored, never written by the editor any more), each optional (a sky
  box with none saved -- a brand new one, or one from before a field was touched -- shows the defaults).

## Acceptance Criteria
```gherkin
Scenario: A new sky box starts at the default gradient
  Given a SkyBox3D is added
  Then the Inspector shows Top color #2f6fb0 and Horizon color #cfe9ff
  And its position/rotation/scale fields are hidden (they do nothing)

Scenario: The colors reach the ROM
  Given a sky box with a red top and a blue horizon
  Then the compiled scene's skyBox is { topColor: red as RGB15, horizonColor: blue as RGB15 }

Scenario: It draws correctly on real hardware
  Given the same scene with a cube in front of the camera
  Then the top of the screen reads red, the bottom reads blue, and the cube still draws over the gradient correctly

Scenario: Real geometry anywhere within the far plane draws in front of it, not just nearby geometry
  Given a tree 90 of the camera's own 100-unit far plane away
  Then the tree draws normally, not hidden behind the sky box

Scenario: A scene with none compiles exactly as before
  Then compiled scene's skyBoxes is empty and the runtime's own flat default backdrop is used, unchanged

Scenario: A day/night cycle, built from two SkyBox3D nodes
  Given a Day sky box (visible) and a Night one (hidden), and a script that hides Day and shows Night on a button press
  Then the Day gradient shows at first, and the Night one shows once the script's own toggle has run -- on real hardware
```

## Notes
- **Built and verified.** Core (`getSkyBox`/`DEFAULT_SKY_BOX`/`isCurrentSkyBox`), the Inspector field (position/
  rotation/scale hidden for this kind specifically; a Current checkbox), the editor-store's `SET_SKY_BOX`/
  `SET_SKY_BOX_CURRENT` actions and undo, the persistence schema (`skyBoxData`, "#rrggbb" pattern, `current`,
  round-trips), the compiler (`translate-scene-3d.ts` compiles every SkyBox3D in the scene, ordered with the
  current one first, RGB15 conversion via the same `parseMeshColor` a mesh's own color already uses), and the
  runtime (`draw_sky_box` in `main.c`, drawing whichever one is visible) -- unit/schema/compiler tests, full
  `vitest run` and `tsc --noEmit` clean across every package, plus **permanent** hardware regression tests
  (`sky-box.rom.test.ts` and `sky-box-cycle.rom.test.ts`, below).
- **Multiple sky boxes, for a day/night cycle** (added after the depth-placement bug below was fixed, in the same
  pass that touched `draw_sky_box` anyway): a scene can now have more than one SkyBox3D. The owner's own request
  was specifically "a current property... for day night cycles"; the real design question was *how* a script
  switches which one is active at runtime, since a bare compile-time marker (the first design considered, an exact
  copy of Camera3D's own `current`) would only pick a fixed winner at compile time and could never actually cycle
  during a game. The owner chose toggling each sky box's own ordinary `visible` instead of a dedicated new script
  function -- no new concept for scripts to learn, reuses a mechanism that already exists, and keeps the runtime
  change small (`draw_sky_box` already had to read `gs_world_visible` for other nodes elsewhere in `main.c`). The
  compiled `GsScene` field changed from one flat `hasSkyBox`/`skyBoxTopColor`/`skyBoxHorizonColor` triple to an
  array of `GsSkyBox { node, topColor, horizonColor }`, and `draw_sky_box` now walks it looking for the first one
  whose own node is visible. `current` only decides the array's own order (and so which one wins if more than one
  happens to be visible at once) and the Inspector's own checkbox state -- it plays no part once the game is
  running. Verified on real hardware (`sky-box-cycle.rom.test.ts`): a script holding a button hides a red "Day" sky
  box and shows a blue "Night" one mid-run, and the captured screen color actually changes between the two.
- **A real bug this story shipped with, caught later by the owner's own screenshots, not by any test at the time:**
  the original version placed the gradient's own literal polygon a few scene units from the camera (the "Distance"
  slider described above, since removed) and relied on alpha < 31 skipping the depth *write* entirely -- on the
  theory that an untouched, just-cleared depth buffer would then let every real polygon drawn afterward win
  regardless of its own distance, "drawing over the sky box correctly regardless of where in the world it actually
  is." The owner's own screenshots of a real forest scene showed background trees rendering as pale, washed-out
  shapes nearly the sky's own color, and a foreground tree's canopy partly missing -- not what either "a tiny far
  plane" or "a cosmetic color issue" would produce. A real ROM, built specifically to isolate it (a plain grey cube
  at several distances, a directional light, nothing else), proved the actual cause: with the sky box present, a
  cube genuinely nearer than the sky's own few-unit placement stayed visible, but the *same* cube at 15, 35 or 90
  scene units -- still well inside the camera's own 100-unit far plane -- vanished behind the sky box completely,
  every time. That is exactly an ordinary "nearer wins" depth test the sky legitimately won against anything placed
  past its own literal few-unit distance, not a skipped depth write; the alpha-based skip either never behaved the
  way the comment assumed, or was overridden by some other DS-hardware-specific rule around a translucent polygon
  being the first to touch every pixel of a frame. Either way, since a v16 vertex can only reach about +-8 units and
  a real scene's own far plane can be up to 1000, there was never a literal distance the old code could have used
  that both fit a v16 vertex and sat beyond everything the camera could actually see -- the bug was unavoidable at
  any "Distance" setting the slider could offer, which is also why raising the slider's own max (the owner's first,
  reasonable ask) would not actually have fixed it.
- **The fix**, and why "Distance" is gone: real geometry reaches arbitrarily far from the origin not by encoding a
  large coordinate directly in its own vertex data (bound to the model format's own small range), but because the
  *modelview matrix's own translation* -- full 20.12 fixed-point precision, computed on the GPU after vertex
  submission -- carries it there. `draw_sky_box` now does the same thing: a small, fixed unit quad (comfortably
  inside v16's own range) is scaled and pushed out to just inside the camera's own real far plane by the modelview
  matrix, not by a literal per-vertex z. Its own device depth then comes out genuinely farther than anything the
  camera can actually draw, so it loses a perfectly ordinary depth test to real geometry at any distance, the same
  way two ordinary opaque meshes already sort against each other -- no alpha trick, no "first polygon of the frame"
  assumption, nothing relying on unconfirmed depth-write-skip behavior. Since the quad's own screen-filling size was
  already computed from an arbitrary "distance" (FOV-scaled, so it fills the screen identically no matter the
  value), tying that same computation to the far plane instead of a separate user value changed nothing visible
  about the gradient itself -- which is also exactly why "Distance" had become a control with no remaining effect,
  and was removed from the Inspector rather than left to confuse the next person who drags it and sees nothing
  happen. A pre-fix project file's own saved `distance` key is still accepted by the schema (never erroring an old
  file) but is no longer read by anything.
- **Verified on real hardware**, not just reasoned about: `sky-box.rom.test.ts` (committed, not a throwaway probe --
  this story shipped once already without a permanent hardware test, and that is exactly how a severe, visible bug
  reached the owner's own hands undetected) checks a grey cube 90 of the camera's own default 100-unit far plane
  away draws normally with the sky box present, and that empty screen space still shows the gradient (not grey)
  when nothing is there. The original gradient-direction check (red top / blue horizon, a foreground cube still
  drawing over it) was also re-confirmed by hand during this fix, unchanged by it.
- The "skip depth write via alpha < 31" assumption, and the `GL_BLEND`-is-a-geometry-engine-wide-switch note that
  goes with it, are both still true of how `GsMesh.alpha` itself behaves for an ordinary translucent mesh (see
  `draw_mesh`'s own comment) -- only the sky box's own, different situation (the very first polygon drawn every
  frame, covering the whole screen) turned out not to get the same treatment in practice.
- **Not built:** a true textured/cubemap skybox (ruled out: DS fill-rate and texture memory, and no real DS game
  does this), a gradient with more than two stops, and a WYSIWYG preview of the gradient in the editor's own 3D
  viewport (today's viewport background is a fixed dark color regardless of any backdrop setting, sky box included
  -- this doesn't regress anything that worked before, but means the editor doesn't yet show what the ROM will
  actually look like for this specific property).
