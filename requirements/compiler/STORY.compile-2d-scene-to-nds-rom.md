---
status: in-progress
component: compiler
related: [TASK.compile-2d-sprites.md, scene-designer/STORY.import-sprite-image.md, EPIC.compile-and-export-nds-rom.md, STORY.compile-3d-scene-to-nds-rom.md, STORY.compile-diagnostics-for-unsupported-content.md, scene-designer/SPIKE.custom-mesh-and-sprite-import.md, scene-designer/STORY.dual-screen-2d-viewport.md]
---

# Story: Compile a 2D scene into a runnable DS ROM

## Context
The 3D milestone came first because it was the only mode with real content. **The first 2D slice is built:**
a `Sprite2D` can have an imported picture (`scene-designer/STORY.import-sprite-image.md`), and a 2D project
compiles to a ROM that draws its sprites on both screens (`TASK.compile-2d-sprites.md`, verified pixel by pixel in
the emulator). What is still missing for this story to be `done`: tile maps, text labels, animated sprites (sprite
sheets), scripts, sound and animation players in 2D projects, and drawing the 2D nodes of a 3D project's 2D screen.
The compiler warns about each of those (`two-d-node-not-built`, `two-d-scripts-not-built`) instead of silently
dropping them.

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
Scenario: Sprite images are compiled (done, see TASK.compile-2d-sprites.md)
  Given sprites with images on either screen
  Then they are drawn where the editor shows them

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
- The placeholder-rectangle stopgap described below was not needed: images were built first.
- The ROM-side counterpart of the placeholder nodes: a stopgap that draws
  each sprite marker as a solid rectangle would prove the 2D pipeline
  without an asset system, at the cost of building something that gets
  replaced. Worth deciding when this is picked up.
