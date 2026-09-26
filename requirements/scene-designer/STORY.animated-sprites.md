---
status: done
component: scene-designer
related: [STORY.import-sprite-image.md, STORY.script-and-rotate-2d-nodes.md, STORY.sprites-on-the-2d-screen-of-a-3d-project.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, scripting/STORY.write-and-run-scripts.md]
---

# Story: Animated sprites from sprite sheets

## Context
A `Sprite2D` shows one picture. Characters, coins and effects need frames: a **sprite sheet** (one PNG holding a grid of equal frames) played as named animations. The node kind
`AnimatedSprite2D` already existed in the editor and was reported as "not built"; this story builds it end to end: model, import, editor, compiler, both runtimes and scripts.

## Decisions (made with the product owner: "Animated sprites that allow sprite sheets"; the rest I chose, say if any is wrong)
- **A sheet is an ordinary sprite image with a frame size.** `ImportedSprite` gains optional `frameWidth` / `frameHeight`; `width` x `height` are the whole sheet. No separate asset
  type, so the image list, palettes, saving and the "Image" pickers keep working. Frames are numbered left to right, top to bottom, from 0.
- **Importing a sheet asks for the frame size** (one of the DS's twelve sprite sizes; the Inspector has a Frame size select and "Import sheet PNG..."). The sheet must be a whole
  number of frames, and a picture that isn't a sprite size is still refused, with a hint about sheets. Frames are never resized.
- **All frames share the sheet's one 256-color palette** (index 0 transparent), so a sheet costs one of a screen's 16 sprite palettes however many frames it has. The whole sheet
  goes into sprite memory (counted against the screen's 128 KB: a sheet of 16 frames of 64 x 64 is 64 KB).
- **Animations live on the node** (`SceneNode.spriteAnimations = { animations: [{ name, frames: number[], fps, loop }], start? }`): a frame may repeat, speeds are 1 to 60 frames a
  second, names are unique on the node (what a script calls them). `start` plays when the scene starts; without it the sprite shows frame 0.
- **A sheet imported onto an AnimatedSprite2D with no animations gets one, "default", playing every frame from the start**, so the picture moves at once. Importing a sheet with nothing
  selected creates an AnimatedSprite2D that way; a single picture still creates a Sprite2D. Choosing a smaller sheet drops the frames it lacks (and animations left empty).
- **Where it runs:** 2D projects (both screens; they run no scripts, so the start animation plays by itself) and the 2D screen of a 3D project (where scripts can also start, stop and
  ask about animations, and move/turn/scale/hide the sprite like a `Sprite2D`).
- **Script API** (3D projects): `$Hero.play("run")` / `play("run")` on its own node, `stop()`, `is_playing()`. The name must be one of the node's animations (checked when the script is
  checked: an unknown name lists the ones that exist). `speed_scale` stays AnimationPlayer-only.
- **Timing:** an animation goes `fps / game fps` frames each game frame (a 20.12 step, added up), so 12 frames a second is right at 30 and at 60 frames a second. A non-looping animation
  stops on its last frame (`is_playing()` becomes false); `play` starts from the first frame.
- **Not built:** flipping a frame (use a negative scale), per-frame durations, playing backwards (write the frames in reverse: "3-0"), animation events, sheets with spacing or margins
  between frames, sprite sheets on 3D meshes, a live animated preview in the 2D viewport (it shows the starting frame; the Inspector's Preview button plays an animation).

## Description
- Core (`imported-sprite.ts`, `sprite-animation.ts`): `getSpriteFrames`, `getSpriteFramePixels`, `spriteToRgba(sprite, frame)`, `createSpriteFromRgba(..., { frame })`; animation helpers
  (`getSpriteAnimations`, `parseFrameList` / `formatFrameList` for "0-3, 5", `nextAnimationName`). The JSON schema and validator accept the new fields and check the frame size,
  unique names, frames inside the sheet and a start that exists.
- Script checker: `play` / `stop` / `is_playing` also work on an AnimatedSprite2D (`animCall` with `sprite: true`); position, rotation, scale and visible are the Sprite2D members.
- Compiler (`collectSprites`): an image carries `frames` (one frame's size, the frames' tiles one after another); `DsScreen2D.animations` holds every animation of the screen and each
  sprite says which one starts and where its own are; errors `animation-frame-out-of-range`, warnings `animated-sprite-without-animations` and (existing) `sprite-without-image`.
- Runtimes (`runtime/` and `runtime2d/`): one block of sprite memory per frame, `gs_sprite_anim.h` (identical in both, a test checks it) steps the animations each game frame, and
  the hardware sprite is pointed at the frame's tiles (`oamSetGfx`). Scripts call `gs_sprite_play/stop/is_playing(node)`.
- Editor: Inspector `SpriteSheetField` (sheet picker, frame size, import, the sheet drawn with its frames numbered) and `SpriteAnimationsField` (add, rename, frames as text, speed, loop,
  remove, Preview, "Plays at the start"); store actions `SPRITE_ANIM_ADD/SET/REMOVE/START` (undoable, typing merges) and the extended `IMPORT_SPRITE` / `SET_SPRITE_IMAGE`; the 2D viewport draws the starting frame.

## Acceptance Criteria
```
Scenario: A sprite sheet is imported with its frame size
  Given an AnimatedSprite2D and a PNG that is a grid of 16 x 16 frames
  When Frame size 16 x 16 is chosen and "Import sheet PNG..." is used
  Then the sheet is on the node with one animation playing every frame, and the Inspector shows the sheet with its frames numbered

Scenario: A sheet that isn't a whole number of frames is refused
  Given a 48 x 16 PNG and a frame size of 32 x 16
  When it is imported
  Then nothing changes and the Output log says it isn't a whole number of 32 x 16 frames

Scenario: An animation is edited
  When an animation is added, named, given frames "2, 3", a speed and looping off, and made the start animation
  Then the project holds exactly that, a bad frame list is refused with a message, and a name another animation has is put back

Scenario: The ROM shows the right frame and moves on by itself
  Given sprites showing different frames, and an animation that ends on frame 3
  When the ROM runs in the emulator
  Then each sprite shows the frame the project says (an animation that has run to its end shows its last frame), on both screens, in a 2D project and on the 2D screen of a 3D project

Scenario: A script plays an animation
  Given an AnimatedSprite2D with a script that calls play("go") when the scene starts
  Then the ROM plays it, and a name the sprite doesn't have is an error that lists the ones it has
```

## Notes (built and verified)
- **Unit tests:** `core/src/sprite-animation.test.ts` (sheets, frame lists, animations), `persistence/.../sprite-sheet-schema.test.ts`, `compiler/src/animated-sprites.test.ts` (tables, steps,
  errors, C output, script calls, the shared header), `ui/.../animated-sprite-edits.test.ts` (import, edit, undo).
- **Emulator:** `compiler/src/testing/animated-sprites.rom.test.ts`: a 2D project (top 1.0000, bottom 0.9993 against a reference painted from the sheet: a sprite with no start animation
  shows frame 0, one starting on frame 2, one that runs 1-2-3 and must end on 3, one on the bottom screen) and a 3D project whose script calls `play("go")` (0.9993). The existing
  `sprites-2d.rom` and `sprites-3d.rom` still pass after the struct changes.
- **Real app:** `tests/prototypes/e2e/animated-sprite.mjs` (9 checks): the fields, a refused sheet, a real import with a chosen frame size, the viewport pixels (frame 0 red, then the
  start animation's first frame blue), adding and editing animations, refused input, the Inspector preview really changing frame, saving, undo. It found two bugs the unit tests
  could not: a rejected name stayed in the text field, and the preview restarted on every tick (an effect that depended on an array rebuilt every render). The script's first runs also
  hit `Runtime.callFunctionOn timed out` about one run in three (an environment flake seen in other E2E scripts too; rerun).
- **Bug caught by a unit test on the way:** sprite placement (centering, the off-screen check) used the whole sheet's width instead of one frame's.
- **Not tried:** a real mouse-driven import of a large sheet, and sheets whose frames don't fit the 128 KB (the check is unit-tested, not run on the DS).
