---
status: in-progress
component: scene-designer
related: [STORY.choose-2d-screen-in-3d-project.md, STORY.import-sprite-image.md, compiler/TASK.compile-2d-sprites.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, touch/STORY.touch-areas.md]
---

# Story: Sprites on the 2D screen of a 3D project

## Context
A 3D project has two screens: the 3D engine drives one and the other is a 2D screen (`STORY.choose-2d-screen-in-3d-project.md`). The editor let you place 2D nodes there,
but the ROM drew nothing on it (`two-d-node-not-built`). This is the first slice of making that screen real: **`Sprite2D` nodes are drawn**, with the same imported,
converted images and the same hardware sprite path as a 2D project.

## Decisions (made with the product owner)
- **First slice: draw sprites.** Scripts moving 2D nodes, `Label` text, tile maps and animated sprites come later.
- **VRAM split: only when needed.** The 3D engine uses all four 128 KB VRAM banks (512 KB) for textures. A 3D project whose 2D screen has no sprite keeps 512 KB. As soon as
  a sprite is drawn on the 2D screen, bank D holds the sprite tiles and textures get banks A to C, **384 KB**. The compiler checks textures against the limit the project
  actually gets (`texture-memory` says the bank is taken by the sprites), and the Hardware tab shows that limit.

Choices I made without asking (say if any is wrong):
- **Same rules as a 2D project's sprites**: centered on `position` at absolute screen pixels, tree order is drawing order, a node is drawn if it is itself visible, at most 128
  sprites, 16 distinct images (one extended palette each) and 128 KB of tiles on the 2D screen. The shared code is `collectSprites` (`translate-scene-2d.ts`).
- **The sub engine draws them.** The 3D engine is the main engine, so the 2D screen is always the sub engine's (tiles in bank D, palettes in bank I), whichever physical screen
  it is. The 3D screen has no sprites.
- **Which screen a sprite is on follows from the project** (its 2D screen), not from the node's own `screen` field.
- **The sprite bank is reserved when a sprite with a picture is visible in a 3D project** (the Hardware tab's rule, conservative); the compiler reserves it when at least one
  sprite is actually drawn (one entirely off the screen doesn't count).
- The backdrop of the 2D screen stays black.

## Description
- `translateScene3D` collects the sprites (`DsScene3D.sprites2D`), checks them and the texture limit; `two-d-node-not-built` no longer names a Sprite2D (a Label, TileMap,
  Camera2D, Area2D and CollisionShape2D still get it (AnimatedSprite2D was built later: STORY.animated-sprites.md), saying "the ROM only draws Sprite2D and AnimatedSprite2D there so far").
- The scene data carries the images and sprites (`scene.h`: `GsScreen2D sprites2D`, the same layout as the 2D runtime's).
- Runtime (`gs_sprites.c`, `main.c`): with sprites, bank D is mapped as sub-engine sprite memory instead of texture memory before the 3D engine starts; `gs_init_sprites()` copies
  the tiles and palettes and sets the sprites up; `gs_update_sprites()` hands the sprite table over right after each vertical blank.
- Editor: the 2D viewport of a 3D project already drew the pictures; the Hardware tab's texture limit follows the rule above (`textureMemoryLimit`).

## Acceptance Criteria
```gherkin
Scenario: A 3D project's sprites appear on its 2D screen in the ROM
  Given a cube and sprites on the 2D screen, with 3D on the top screen
  Then the cube is drawn on the top screen and each sprite on the bottom screen where the editor shows it
  And with 3D on the bottom screen the sprites are on the top screen

Scenario: Textures still work
  Given a textured mesh and a sprite
  Then the mesh keeps its picture and the sprite is drawn

Scenario: The texture budget follows the sprites
  Given a 3D project with textures totalling more than 384 KB but less than 512 KB
  Then it builds without sprites on the 2D screen and is refused, saying why, with one
  And the Hardware tab shows 384 KB once a sprite has a picture

Scenario: What is not drawn is still reported
  Given a Label on the 2D screen
  Then the export warns that it isn't drawn
```

## Verification
`sprites-on-3d.test.ts` (compiler, 9), the emulator tests `testing/sprites-3d.rom.test.ts` (3D on top and on the bottom, and a textured mesh next to sprites: the sprites match a reference
painted from the project's images at 0.9993 to 1.0000 and the cube's silhouette 0.93 to 0.98) and the real-app script `tests/prototypes/e2e/sprites-3d-project.mjs` (5 checks).

## Not built
Scripts reading or moving 2D nodes (`position`/`visible` of a Sprite2D), Label text, tile maps, animated sprites, sprites drawn by the 3D screen's own engine, and a second
2D layer. Dragging a sprite between screens has no meaning here (the screen follows from the project).
