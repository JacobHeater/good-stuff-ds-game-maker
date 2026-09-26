---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, SPIKE.sprite-image-import.md, STORY.mesh-textures.md, STORY.dual-screen-2d-viewport.md, persistence/TASK.embed-imported-sprites-in-project-file.md, compiler/TASK.compile-2d-sprites.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, debugger/STORY.hardware-budget-report.md]
---

# Story: Give a Sprite2D a picture

## Context
A `Sprite2D` was a marker with a position and nothing behind it, so a 2D project had nothing to
draw and `compiler/STORY.compile-2d-scene-to-nds-rom.md` was blocked. This is the first slice of
2D making: import a PNG, put it on a sprite, see it in the editor, and get it in the ROM. It
follows the path 3D textures took (`STORY.mesh-textures.md`).

## Decisions (made with the product owner)
- **First slice: sprite images end to end** (import, viewport, budget, compile, verify in the
  emulator). Tile maps, text labels, animated sprites, scripts and sound in 2D come later.
- **256-color palettes.** A sprite image is 8 bits a pixel with its own 256-color palette
  (RGB15); **index 0 is transparent**, so a picture has up to 255 visible colors.
- **Refuse sizes the DS has no sprite for**, never resize or pad (the same stance as textures and
  `.obj` models). The DS's sprite sizes are 8 x 8, 16 x 16, 32 x 32, 64 x 64, 16 x 8, 32 x 8,
  32 x 16, 64 x 32, 8 x 16, 8 x 32, 16 x 32 and 32 x 64. A 64 x 16 image is refused even though
  both sides are fine on their own.

Choices I made without asking (say if any is wrong):
- **More than 255 colors: reduced, with a warning** (median cut, deterministic) rather than
  refused. Colors are first cut to the DS's 5 bits a channel.
- **Alpha of 128 or more is opaque**, below is clear; partly transparent pixels are counted in a warning.
- **Each distinct image on a screen takes one of the sprite engine's 16 extended palettes**, so a
  screen can use 16 different images (as many sprites as you like share them, up to 128). More is a
  compile error. 4-bit (16-color) sprites, which would allow more, are not built.
- **Sprite memory is 128 KB per screen** (one VRAM bank each), counting one byte a pixel; an image drawn
  on both screens is stored on both.
- **A sprite is drawn centered on its `position`**, at absolute screen pixels (the 2D viewport
  never added parents' positions, and the ROM matches it). A node later in the scene tree is drawn
  over an earlier one. A hidden node is not drawn.
- **A node in a 2D project can now be put on either screen** (Inspector "Screen", one undo step).
  That select was disabled, so before this a 2D project could only ever use the top screen. In a 3D
  project it stays disabled: the screens follow from what draws each node.
- Same storage decision as textures: **embedded in the project file, already converted**; the
  original PNG is not kept.

## Description
- The Inspector of a Sprite2D shows an **Image** field ("None" or any imported image, by name and
  size), an **Import PNG...** button that converts a file, adds it to the project and puts it on the
  sprite, and a preview with its size and memory cost.
- **Scene > Import Sprite Image...** does the same with no sprite selected, adding a new Sprite2D in
  the middle of the screen.
- The 2D viewport draws the sprite's image (nearest-neighbor, transparent where index 0 is), centered
  on its position, in tree order. A sprite without an image is still the old marker.
- The Hardware tab shows, per screen, sprite count, **sprite memory** (of 128 KB) and **sprite
  palettes** (of 16).
- Importing and choosing an image, and choosing a node's screen, are undoable. An image no sprite uses
  is dropped when the project is saved.
- The compiler refuses too many sprites, images, or bytes on a screen, and a sprite naming an image the
  project lacks; it warns about a sprite with no image and one entirely off its screen.

## Acceptance Criteria
```gherkin
Scenario: The Inspector offers an image on a Sprite2D
  Given a Sprite2D is selected
  Then the Inspector shows an Image field set to None, and an "Import PNG..." button
  And a node that isn't a Sprite2D shows neither

Scenario: Importing a PNG gives the sprite its picture
  Given a Sprite2D is selected
  When a 32 x 32 PNG is imported
  Then the image is in the project and on the sprite
  And the 2D viewport draws it 64 screen pixels square, transparent where the PNG was

Scenario: A size the DS has no sprite for is refused
  When a 24 x 24, 128 x 128 or 64 x 16 PNG is imported
  Then the Output log says which sizes exist, and nothing changes

Scenario: Too many colors are reduced with a warning
  When a PNG with 4096 colors is imported
  Then the image has 255 colors and the Output log warns about it

Scenario: Each screen draws and counts its own sprites
  Given a sprite on the top screen and one on the bottom screen
  Then the Hardware tab counts each screen's images and memory separately

Scenario: Undo removes the image
  When the import is undone
  Then the sprite has no image and the project holds no image

Scenario: The ROM shows what the editor shows
  Given a project made in the editor
  When it is compiled and run in the emulator
  Then both screens match a reference drawn from the project's own images
```

## Verification
`imported-sprite.test.ts` (core, 12), `imported-sprite-schema.test.ts` (persistence, 7),
`sprite-edits.test.ts` (store, 11), `translate-scene-2d.test.ts` (compiler, 18),
`sprites-2d.rom.test.ts` (emulator: both screens compared pixel by pixel with a reference painted
from the images, match 1.0000 top / 0.9993 bottom; draw order swapped; and a project authored through
the real UI), and `tests/prototypes/e2e/sprite-image.mjs` (11 checks in the real app: refused files,
the viewport's drawn pixels, the Hardware tab, undo/redo, two screens, save/reopen, Export ROM).

## Notes
- **The renderer's Content-Security-Policy blocked `data:` images** (`default-src 'self'`), so the first
  version drew broken-image icons in the viewport; found by the E2E test's pixel check. The policy now
  has `img-src 'self' data:` (`apps/desktop/src/renderer/index.html`).
- Not built: dragging a sprite between screens, `AnimatedSprite2D` (sprite sheets: built later, see STORY.animated-sprites.md), rotation and
  scale of sprites, 16-color images, the original PNG, sprite priority layers, and 2D nodes inside a
  3D project's 2D screen (they are editable but the ROM doesn't draw them yet; a warning says so).
