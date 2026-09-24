---
status: proposed
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, STORY.compile-3d-scene-to-nds-rom.md, STORY.compile-diagnostics-for-unsupported-content.md, scene-designer/SPIKE.custom-mesh-and-sprite-import.md, scene-designer/STORY.dual-screen-2d-viewport.md]
---

# Story: Compile a 2D scene into a runnable DS ROM

## Context
The 3D milestone comes first because it's the only mode with real content:
four built-in primitives can be drawn. 2D has nothing to draw yet. A
`Sprite2D` is a marker with a position, with no image behind it; there's no
tilemap data, no label text, no sprite sheet, and no way to import any
(`scene-designer/SPIKE.custom-mesh-and-sprite-import.md`). A 2D ROM built
today would be two blank screens.

## Description
Deferred until 2D content exists. When it does, compile a 2D project so the
DS's two independent 2D engines show each screen's nodes at the positions
the dual-screen viewport shows, using the DS's sprite hardware (up to 128
per screen, 64 pixels at most on a side).

This story is deliberately thin. It should be specified properly, with
real acceptance criteria, when the asset pipeline is designed, because how
2D assets are stored and referenced decides what there is to compile.

## Acceptance Criteria
```gherkin
Scenario: Blocked until 2D content exists
  Given no way to attach an image to a Sprite2D
  Then this story is not started

Scenario: A 2D project's sprites appear where the editor shows them
  Given sprites with images, on the top and bottom screens
  When the project is compiled and the ROM run
  Then each sprite appears on its screen at its position
  And the sprite counts stay within the per-screen hardware limit

Scenario: Both screens are used
  Given nodes on both screens
  Then both physical screens show their own nodes
```

## Notes
- The ROM-side counterpart of the placeholder nodes: a stopgap that draws
  each sprite marker as a solid rectangle would prove the 2D pipeline
  without an asset system, at the cost of building something that gets
  replaced. Worth deciding when this is picked up.
