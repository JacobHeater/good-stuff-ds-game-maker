---
status: in-progress
component: scene-designer
related: [STORY.standalone-2d-scripting.md, STORY.standalone-2d-sound.md, STORY.standalone-2d-collision.md, STORY.standalone-2d-camera.md, STORY.standalone-2d-tilemaps.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, STORY.animated-sprites.md, STORY.labels-and-text.md, TASK.save-fps-target-in-project.md, audio/STORY.import-sound-and-audio-player.md, collision/EPIC.collision-shapes.md]
---

# Epic: A standalone 2D project can be a full game

## Context
Owner: "2D dev is extremely under developed... lets make 2D Dev usable for a full game," followed by "any kind of game
should be possible so do all of the necessarys" when asked whether to prioritize a specific genre.

Before this epic, a standalone 2D project's ROM was a static/animated picture: sprites and sprite-sheet animations drew
and text labels showed, but nothing could run any logic, read the D-pad or touch screen, play a sound, detect an overlap,
scroll past one screen's worth of content, or switch scenes. All of that already worked for 2D nodes drawn on the spare
screen of a *3D* project (a different, much more capable compile path) -- the standalone 2D runtime (`runtime2d/`) just
never got any of it. Two decisions set the shape of the work:
- **Keep 2D on its own dedicated runtime** (`runtime2d/`), not merged into the 3D one, even though a 3D project's 2D
  screen already proves most of what 2D needs works. A 2D ROM stays its own, smaller, independent binary.
- **Support any kind of 2D game**, not just one genre -- so this is sequenced as a stack of general-purpose building
  blocks (scripting, then sound, then collision, then camera/tilemaps, ...), not features picked for one game shape.

## Sequencing
Scripting first, because every other capability is only useful once a script can react to it -- sound without a way to
call `play()`, collision without a way to ask `overlaps()`, a camera without a way to move it are all dead weight. Each
item below is its own story, built and verified independently, in roughly this order:

1. **Scripting + input** (`STORY.standalone-2d-scripting.md`, done). A script runs in a 2D ROM: reads buttons and touch,
   moves/turns/scales/shows/hides a `Sprite2D`/`AnimatedSprite2D`, changes a `Label`'s text or value, starts/stops a
   sprite's own animation by name, and uses global variables. A capability nothing has built for 2D yet (sound, an
   AnimationPlayer, switching scenes) is a safe no-op rather than a build or link failure, so later stories only have to
   replace a stub, never retrofit safety.
2. **Sound** (`STORY.standalone-2d-sound.md`, done). `AudioStreamPlayer` in a 2D project: its sound(s) compile into
   the ROM and `gs_stubs2d.c`'s audio no-ops are replaced with real playback, mirroring the 3D runtime's
   `gs_runtime.c`/named-audio-clips work.
3. **Collision** (`STORY.standalone-2d-collision.md`, done). `CollisionShape2D` (a rect/circle, simpler than 3D's
   box/sphere/capsule/cylinder/hull) overlap detection via `overlaps()`, so a script can tell when two things touch
   -- hits, pickups, triggers. `Area2D` stays an inert grouping node, same as before.
4. **Camera / scrolling** (`STORY.standalone-2d-camera.md`, done). A `Camera2D` a script can move; every sprite on
   its screen follows it (the DS's OAM sprite hardware has no global scroll register, so this is done by
   repositioning every sprite each frame) -- what lets a level be bigger than one screen. No bounds, deadzone or
   follow/smoothing helper yet (plain script math already covers it).
5. **Tilemaps** (`STORY.standalone-2d-tilemaps.md`, done). A `TileMap`'s sheet is an ordinary imported sprite sheet
   (8 x 8 frames); it draws with a DS background layer instead of the sprite engine (4bpp, 15 colors plus
   transparent -- the hardware's own ceiling for that), scrolls with its screen's camera the same way a sprite
   does, and a script can ask `tile_solid(x, y)`. One tile layer a screen (the hardware's spare background layer),
   no multi-layer maps, no built-in collision resolution.
6. **AnimationPlayer in 2D** (not built). `AnimatedSprite2D`'s own sheet animation covers a lot, but a scene-wide
   AnimationPlayer (moving several nodes together, non-sprite-sheet animation) is still 3D-only.
7. **Switching scenes in 2D** (not built). A 2D ROM only ever holds its starting scene; `change_scene()` already
   compiles (story 1) but nothing acts on it yet.
8. **Saving the game in 2D** (not built). `gs_save_game`/`gs_load_game`/`gs_has_save` are stubs that always say there is
   no save; real save-file I/O for 2D mirrors the 3D runtime's `gs_save.c`.
9. **Editor/viewport polish** (not built, lower priority -- doesn't block a ROM from being a real game). The 2D
   viewport has no gizmos (rotate/scale are Inspector-only), no click-to-multi-select or marquee-select, and no
   pan/zoom, all of which the 3D viewport already has.

## Notes
- Each story in this list gets its own requirements doc when it's picked up, cross-referenced here and back to this
  epic, the same way the rest of this codebase's `requirements/` tree works -- this doc is the index and the
  rationale for the order, not a substitute for a real spec per item.
- "Done" below only ever means "done for what it covers" -- this epic itself stays `in-progress` until the last item
  above is built, however long that takes across however many separate pieces of work.
