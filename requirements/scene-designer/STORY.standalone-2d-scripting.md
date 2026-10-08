---
status: done
component: scene-designer
related: [EPIC.full-2d-games.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, STORY.animated-sprites.md, STORY.labels-and-text.md, STORY.script-and-rotate-2d-nodes.md, scripting/EPIC.scripting.md]
---

# Story: A script can run in a standalone 2D project

## Context
First item of `EPIC.full-2d-games.md`. Before this, a 2D project's ROM ran no scripts at all (`two-d-scripts-not-built`,
unconditional) -- it was a static/animated picture with no way to read input or react to anything. A 3D project's spare
2D screen, by contrast, already had full scripting for the same node kinds (Sprite2D, AnimatedSprite2D, Label,
TouchArea2D): the checker (`checker.ts`) and codegen (`script-codegen.ts`) resolve a sprite's `position.x`, a label's
`.text`/`.value`, `Input.*` and so on entirely generically, off the node's *kind*, with no dependency on there being any
3D content in the scene at all. Investigating confirmed this directly: the same functions `translateScene3D` already
calls (`checkProjectScripts`, `orderGlobalsForRuntime`, `generateScriptCode`) work unchanged against a scene that is
purely 2D nodes, and the 3D runtime's own per-node services for a Sprite2D/Label (`gs_sprites.c`, `gs_labels.c`) never
touch anything 3D-shaped (no matrix, no camera, no mesh) -- they already are, in effect, 2D-only code, just living in the
wrong runtime. So this story is "port proven code and wire it up," not a from-scratch script interpreter.

## Decision
- **Reuse the compiler's existing script pipeline as-is.** `translateScene2D` now calls the exact same
  `checkProjectScripts`/`orderGlobalsForRuntime`/`generateScriptCode` (exported from `translate-scene-3d.ts`) that
  `translateScene3D` does. No changes were needed to the checker or codegen themselves.
- **A capability nothing has built for 2D yet is a safe no-op, not a compile error or a risk of a broken ROM.** Sound, an
  AnimationPlayer, 3D-only collision/raycasting, 3D mesh animation, and saving the game are all things the checker will
  happily resolve a call against (an `AudioStreamPlayer`/`AnimationPlayer` node *is* offered in a 2D project, for when
  those stories land) -- rather than trying to detect and block every such call at compile time, `runtime2d` now
  declares and safely stubs the entire relevant slice of `gs_api.h` (`gs_stubs2d.c`): every stub behaves exactly like
  the existing, already-shipped "a player with no sound of its own" / "a node with no AnimationPlayer" contract
  (`-1` index in, no-op out) already documented in `gs_api.h` for the 3D runtime. This means every later story in
  `EPIC.full-2d-games.md` *replaces* a stub rather than retrofitting safety into something that previously couldn't
  compile at all.
- **No parent hierarchy in the node table.** A 2D project's positions are always absolute screen pixels
  (`translate-scene-2d.ts`'s own long-standing design), so the node table a script reaches through is simpler than 3D's:
  no parent index, no world-matrix composition, just the flat values a script can read and write directly.

## Description
- **Compiler** (`translate-scene-2d.ts`): checks scripts and builds the global-variable table with
  `checkProjectScripts`/`orderGlobalsForRuntime` (now exported from `translate-scene-3d.ts`, since neither depends on
  anything 3D-specific). The node table is every node in `scripts.touchedIds` (attached to a script, or named with
  `$Name`), in tree order -- a `SpriteLiveness` built from it is passed into `collectSprites`/`collectLabels` (the same
  function a 3D project's 2D screen already uses, via its `live` parameter), so a sprite/label a script can reach gets
  a real node index, `dynamic: true` when its transform is written, and a rotation matrix when it starts turned/scaled
  or a script can turn/scale it. `generateScriptCode` emits the scene's one and only script file with no scene prefix
  (a 2D project never has more than one compiled scene). The `extra-scenes-not-built` warning's wording changed
  slightly: `change_scene()` now compiles fine, it just has nothing to switch to yet.
- **Data** (`ds-scene.ts`, `scene-data-writer.ts`): `DsScene2D` gained `nodes: DsNode2D[]` (name, position, rotation,
  scale, visible -- the same slots and the same `toF32` units `translate-scene-3d.ts`'s own node table already uses for
  a Sprite2D/Label), `globals: DsGlobal[]`, and `scriptCode: string`. `DsSprite`/`DsLabel`'s `node`/`dynamic`/`affine`/
  `rotation`/`scaleX`/`scaleY` fields (already there, documented "only in a 3D project") are simply used for a
  standalone 2D project too now. `writeScene2DDataC` emits the node table, the project's globals (byte-identical
  approach to the 3D writer's own globals block), and the generated script code, all in the one `scene2d_data.c` file.
- **Runtime** (`runtime2d/`): new `include/gs_api.h` (the 2D project's own copy of what generated script code may call --
  the same shape as the 3D runtime's, since the generated C is identical either way, but documents which functions are
  real here and which are `gs_stubs2d.c`'s safe no-ops). `scene2d.h`'s `GsSprite` gained the exact fields `scene.h`'s
  already has (same layout, so a script reaches a sprite the same way in either kind of project); `GsLabel.node` lost
  its "only in 3D projects" comment; new `GsNode2D` (the compile-time initial values `GsNodeState`, gs_api.h's live
  struct, is initialized from) and `GsScene2D.nodeCount`/`nodes`. New `gs_runtime2d.c`: `gs_init_nodes2d` (allocates and
  fills `gs_node_state` once, no world-matrix composition needed), `gs_read_input` (buttons and touch -- a verbatim port
  of the 3D runtime's own, since none of it is 3D-specific), and a real (if currently unused) `gs_change_scene`/
  `gs_pending_scene`. `main.c` gained: `follow_sprite`/`set_matrix` (the 3D runtime's `gs_sprites.c` `follow`, ported --
  a dynamic sprite's position/rotation/scale/visibility now tracks its node every frame, and a sprite that starts
  rotated or scaled gets its matrix set up at load time too), `gs_sprite_play/stop/is_playing` and `gs_label_set_value/
  get_value/set_text` (both search across *both* screens by node index, since a 3D project only ever has one 2D screen
  to search but a standalone 2D project has two), and the script dispatch itself: every instance's `_ready()` runs once
  before the first frame draws, then `_process()` runs every frame after `gs_read_input()` and before the sprites/labels
  are brought up to date and `oamUpdate`'d.
- **New `gs_stubs2d.c`**: safe no-op implementations of everything `EPIC.full-2d-games.md`'s later items will build for
  real -- sound, 3D-only collision/raycasting (impossible to actually reach from a 2D project's node set, since it has
  no `CollisionShape3D`, but declared so the link always succeeds), 3D mesh animation (likewise unreachable), an
  AnimationPlayer, and saving the game.

## Notes (built and verified)
- Unit tests: `compiler/translate-scene-2d.test.ts` (new `describe("scripting a 2D project", ...)`: a script moves a
  sprite (node table entry, `dynamic: true`, correct `gs_node_state[...]` codegen); a sprite nothing reaches stays
  `node: -1, dynamic: false`; a script sets a label's text and value; input and global variables compile correctly;
  `play("name")` on an AnimatedSprite2D; a script error is reported exactly as in a 3D project (line, column, the
  project refused); a script that calls `play()` on an AudioStreamPlayer -- not built yet -- still compiles cleanly,
  emitting a call to the (stubbed) `gs_audio_play`/`gs_node_audio_player`). Existing 2D tests across `translate-scene-2d.
  test.ts`, `labels.test.ts` and `animated-sprites.test.ts` updated for `DsSprite`/`DsLabel` now always carrying their
  live-state fields. Full fast suite (1201 tests) and typecheck (core/persistence/compiler/ui) pass.
- **Verified with a real devkitARM build** (compiled and linked, not run in an emulator): a hand-written project
  exercising every new path at once -- a script with a global variable, `Input.is_button_down`/`is_button_pressed`/
  `is_touching`, moving and rotating a `Sprite2D`, starting an `AnimatedSprite2D`'s animation by name, setting a
  `Label`'s `.text`/`.value`, a `TouchArea2D`'s `is_touched()`, and `$Music.play()` on an `AudioStreamPlayer` (the stub
  path) -- produced a `.nds` with no compiler or linker errors. This is the first runtime change in a long while in this
  codebase to get an actual native-toolchain compile check rather than only the generated-C-text unit tests; it caught
  one real bug before it shipped (`translate-scene-2d.ts` was writing a node's position as a plain pixel integer instead
  of the `f32` `toF32(...)` every other position in the engine uses, which would have made every scripted sprite jump to
  a wildly wrong, uninitialized-looking position the instant a script touched it).
- **Not verified:** actually running the built ROM in an emulator or on hardware (no `*.rom.test.ts` case yet, and no
  emulator was launched this time -- only a compile-and-link check). **Not built:** everything else in
  `EPIC.full-2d-games.md` (sound, collision, camera/scrolling, tilemaps, AnimationPlayer, scene switching, saving, and
  2D-viewport editor polish) -- see that epic for the plan and the reasoning behind its order.
