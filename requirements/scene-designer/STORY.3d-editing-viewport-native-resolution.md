---
status: done
component: scene-designer
related: [EPIC.scene-designer.md]
---

# Story: 3D editing viewport at native DS resolution

## Context
The DS has a real (if limited) 3D engine: texture-mapped polygons,
~2048 triangles/frame, exclusive to a single screen at a time (see
`DS_HARDWARE_PROFILE.graphics3D` in `packages/core/src/hardware.ts`).
A modern smooth, high-res, antialiased Three.js scene looks nothing
like what that hardware actually produces, so the 3D viewport needs to
render authentically low-res and blocky — but it also has to be a
genuinely usable working area, not a toy.

Getting this right took three iterations, and the wrong ones are
recorded here specifically so they aren't tried again:

1. **v1 — whole canvas at a tiny fixed native size.** The entire
   `<Canvas>` was rendered at literal 256×192 and only CSS-upscaled via
   `transform: scale(2)`. This produced an authentically pixelated
   look, but the working area itself was small and cramped — rejected
   as unusable ("how can I build a game there?").
2. **v2 — large smooth edit canvas + separate small pixelated preview
   inset.** A full-size, normal-resolution canvas for editing, plus a
   small corner inset rendering the same scene at native resolution
   through the scene's `Camera3D` node, mimicking Godot's
   editor-viewport-vs-Game-window split. This was also rejected — the
   user wants one working area, not a separate preview to context-switch
   to.
3. **v3 (current, correct) — one canvas, full available size, fixed
   internal resolution.** The working rectangle is sized by a
   `ResizeObserver` (`useContainedSize` in `Viewport3D.tsx`) to fill as
   much of the available panel as possible, up to the DS's 4:3 aspect
   ratio. The actual WebGL drawing buffer stays locked to true 256×192
   via a **fractional device-pixel-ratio** passed to `<Canvas dpr={...}>`
   (`DS_WIDTH / displayedWidthInPixels`), with antialiasing off and
   `image-rendering: pixelated` on the canvas element. The box can be
   as large as the panel allows and still renders exactly 256×192
   real pixels internally — the pixelation survives at any size.

## Description
Render the currently-active-screen's 3D content (whichever screen owns
the DS's single 3D engine) in a working canvas that fills the
available "3D" workspace tab panel space (up to the DS's 4:3 aspect
ratio), with free orbit-camera navigation and click-to-select on scene
nodes, while the actual rendered resolution stays locked to the DS's
native 256×192 so the visual result reads as authentically low-res DS
3D rather than smooth modern 3D.

## Acceptance Criteria
```gherkin
Scenario: The 3D canvas fills the available panel
  Given the editor is on the "3D" workspace tab
  Then the 3D working rectangle is sized to the largest box that fits
    the available panel space while keeping a 4:3 aspect ratio
  And it is not shrunk to a small fixed pixel size regardless of panel size

Scenario: Rendering stays locked to native DS resolution regardless of display size
  Given the 3D working rectangle is displayed at some size on screen
  Then the WebGL drawing buffer renders at exactly 256x192 pixels
  And the displayed image is scaled up with nearest-neighbor
    ("image-rendering: pixelated"), not smoothed/antialiased

Scenario: Only one screen's 3D content is shown at a time
  Given the DS's 3D engine can only output to one screen at a time
  When the "3D" workspace tab is active
  Then the screen filter only offers "Top Screen" or "Bottom Screen", not "Both Screens"
  And only 3D nodes assigned to the currently selected screen are rendered

Scenario: Free camera navigation and node selection work in the 3D canvas
  Given the "3D" workspace tab is active
  When the user drags with the mouse inside the canvas
  Then the orbit camera rotates/pans/zooms freely
  When the user clicks a rendered mesh, camera gizmo, or light gizmo
  Then the corresponding scene node becomes selected
  When the user clicks empty space in the canvas
  Then the scene root becomes selected

Scenario: Node kinds render distinctly
  Given a MeshInstance3D node with a "cube", "sphere", "plane", or "cylinder" primitive
  Then it renders as the corresponding real geometry, colored to indicate selection state
  Given a Camera3D node
  Then it renders as a small cone gizmo, not real geometry
  Given a DirectionalLight3D or OmniLight3D node
  Then it renders as a small glowing marker AND contributes real light to the scene
```

## Notes
- Do not reintroduce a second `<Canvas>`/preview inset for resolution
  accuracy — the fractional-`dpr` technique on the single canvas is
  the intended, accepted solution. If a future request asks for "make
  the 3D view look more like the real DS," re-read this ticket before
  changing the rendering approach.
- `Node3D` (the plain grouping/container kind) intentionally renders
  nothing itself, matching `Node2D`'s equivalent non-rendering
  behavior in the 2D viewport.
- Lighting direction for `DirectionalLight3D` currently only uses the
  node's position, not its rotation (Three.js directional lights point
  from `position` toward a `target`, which defaults to the world
  origin) — the node's rotation field has no visual effect yet. This
  is a known, currently-accepted simplification, not a requirement of
  this story, but is worth its own Task if directional lighting needs
  to be steerable later.
