---
status: done
component: compiler
related: [STORY.compile-2d-scene-to-nds-rom.md, TASK.compile-textures.md, TASK.rom-build-driver.md, scene-designer/STORY.import-sprite-image.md, persistence/TASK.embed-imported-sprites-in-project-file.md]
---

# Task: Compile 2D sprites into a ROM

## Description
A 2D project compiles through its own path, not the 3D one: `compileProject` picks by `project.mode`.

- **`translateScene2D`** (`translate-scene-2d.ts`, pure) produces a `DsScene2D` (`ds-scene.ts`): per screen the distinct images (256 RGB15 palette
  entries, and the pixels **already in the order the sprite engine reads them**: 8 x 8 tiles left to right then top to bottom, each tile row by row;
  `toTileOrder`) and the sprites (top-left corner in screen pixels = `round(position - size / 2)`, image index). Tree order is drawing order, and
  the hardware draws the lowest-numbered sprite on top, so the list is the reverse of tree order (`flattenSceneTreeInOrder` in core; `flattenSceneTree`
  makes no order promise). Hidden nodes and sprites entirely off the screen are left out.
- **Diagnostics.** Errors: `missing-sprite`, `too-many-sprites` (128 a screen), `too-many-sprite-palettes` (16 images a screen),
  `sprite-memory` (128 KB a screen), `not-a-2d-project`. Warnings: `sprite-without-image`, `sprite-off-screen`, `two-d-node-not-built`
  (TileMap, Label, AudioStreamPlayer, AnimationPlayer; AnimatedSprite2D is built, see scene-designer/STORY.animated-sprites.md), `two-d-scripts-not-built`.
  `checkProject` runs the right translator for either mode (Export ROM's pre-check uses it).
- **Writer.** `writeScene2DDataC` emits `scene2d_data.c`: constant data, a pure function of the scene, layouts in `runtime2d/include/scene2d.h`.
- **Runtime** (`packages/compiler/runtime2d`, its own Makefile and `main.c`; the 3D runtime is untouched). The top screen is the main
  engine and the bottom the sub engine, each with 128 KB of sprite memory (banks B and D) and 16 extended palettes (banks F and I, mapped
  as plain memory while they are written). Per image: `oamAllocateGfx` and a DMA copy of the tiles, its palette in the extended slot of the same
  number; per sprite: `oamSet` (priority 0, so hardware order decides), then `oamUpdate` each frame. Backdrops are a dark blue (top) and a
  brown (bottom), so a capture can find each screen.
- **Build driver.** `RomBuilder.build2D` shares `buildFrom` with `build`; the 2D runtime is `runtimeDir2D` (default: `runtime2d` next to
  `runtimeDir`). The desktop app packages it as `compiler-runtime-2d` (`electron-builder.yml`, **packaged path untried**, like the 3D one).
  Export ROM and Play call `compileProject`, so both work for 2D. CLI: `fixture:sprites`.

## Acceptance Criteria
```gherkin
Scenario: A 2D project builds and its sprites appear where the editor shows them, on both screens
Scenario: A sprite later in the tree is drawn over an earlier one
Scenario: Transparent pixels show what is behind
Scenario: A sprite partly off the left edge is clipped, not dropped
Scenario: Too many sprites, images or bytes on a screen is an error naming the screen
```
Verified by `translate-scene-2d.test.ts` and `sprites-2d.rom.test.ts` (see `scene-designer/STORY.import-sprite-image.md`).

## Notes
- Lessons: none surprising on the DS side; the first build drew correctly. The one editor-side surprise was the Content-Security-Policy.
- Not built: sprite rotation/scale (affine), 16-color sprites, per-sprite priority, the 3D project's 2D screen (`two-d-node-not-built`
  stays for it), 30 fps pacing verification (the 2D loop waits vblanks like the 3D one).
