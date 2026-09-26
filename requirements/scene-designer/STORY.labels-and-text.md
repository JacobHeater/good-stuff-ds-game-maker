---
status: done
component: scene-designer
related: [STORY.sprites-on-the-2d-screen-of-a-3d-project.md, STORY.multiple-scenes.md]
---

# Story: Labels (text and HUD)

## Context
A game needs words and numbers on screen: a score, a health count, "Game Over". The `Label` node existed in the editor as an icon but built nothing. This makes it real, the first step of making the engine good enough
for a full 3D game (then: game state and saving, physics, animated 3D characters, a small demo game to find what is still missing).

## Decisions (owner delegated; say if any is wrong)
- **The DS's own font on its text layer.** A label is text in libnds's built-in 8 x 8 font on a background layer, so it sits on the **8 x 8 pixel grid** (32 columns by 24 rows a screen), and its position is rounded to the nearest cell.
  The viewport draws the same cells and dragging moves a cell at a time. No custom fonts, sizes, rotation or scale yet.
- **Eight colors**: black, red, green, yellow, blue, magenta, cyan, white (the console's colors), one per label.
- **Where labels can be.** In a 2D project on either screen (static text). In a 3D project on the 2D screen only (the other screen is the 3D view; text over 3D isn't built), and there scripts drive them.
- **Numbers with `{}`.** Where the text has `{}` the label's `value` (a whole number, starts at 0) is written: text `Score: {}`, script `$Score.value = 5`, screen `Score: 5`. A script can also replace the text with a literal
  (`$Msg.text = "Game Over"`; only a string in quotes, no joining) and hide or show the label (`$Msg.visible = false`). Scripts can't move a label.
- **Text**: printable ASCII, up to 96 characters, one line (line breaks become spaces, anything else `?`). Text past the right edge wraps to the next row's start; past the bottom it is cut.
- **Limits**: 32 labels a screen (error `too-many-labels`); a label whose first cell is off the screen isn't drawn (warning `label-off-screen`) unless a script can reach it; a hidden label is left out unless a script can show it.
- Text is drawn under sprites on that screen.

## Description
- Core: `label.ts` (`LabelData`, `getLabel`, `labelCell`, `labelCellOnScreen`, `labelDisplayText`, `LABEL_COLORS`), `SceneNode.label`, the schema's `labelData`. Script checker: `value` (int) and `text` (assignment of a string
  literal) on Labels, `visible` on Labels, completion offers them.
- Compiler: `collectLabels` (in `translate-scene-2d.ts`), `DsScreen2D.labels`, `label-text.ts`, C arrays `<screen>_labels` and `GsLabel`; script code calls `gs_label_set_value/get_value/set_text`.
- Runtime: `gs_labels.h` (identical in `runtime/` and `runtime2d/`) and `runtime/source/gs_labels.c`. When anything about a screen's text changes, the layer is cleared and every shown label is drawn again in order.
- Editor: Inspector text box and color swatches (`LabelFields.tsx`, action `SET_LABEL`, one undo step per pause when typing), viewport text drawn in the DS grid.

## Notes (built and verified)
- Unit tests: `core/src/label.test.ts`, `core/src/script/script-labels.test.ts`, `compiler/src/labels.test.ts`, `persistence/.../label-schema.test.ts`, `ui/.../label-edits.test.ts`.
- Emulator: `compiler/src/testing/labels.rom.test.ts` checks in real ROMs the box each label's pixels fill (so its cell), their color, the screen, a script's value (`N{}` becoming `N12345`), a script's text, and a hidden label.
- **Not verified:** the editor viewport and Inspector in the real app (no E2E run). **Not built:** labels on the 3D screen, other fonts and sizes, joining text and numbers in a script (`"HP: " + hp`), scripts moving labels, non-ASCII text.
