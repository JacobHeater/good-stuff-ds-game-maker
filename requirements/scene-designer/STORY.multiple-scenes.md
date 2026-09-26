---
status: done
component: scene-designer
related: [STORY.animated-sprites.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, scripting/STORY.write-and-run-scripts.md, persistence/EPIC.project-persistence.md]
---

# Story: Multiple scenes

## Context
A project had one scene tree. A game needs a title, levels and a game-over screen, and a way to move between them while it runs on the DS.

## Decisions (made with the product owner)
- **Switching is a script call, `change_scene("Level2")`.** It works where scripts run: 3D projects and the 2D screen of them. A 2D project's ROM runs no scripts, so it holds only the starting scene
  and says so (`extra-scenes-not-built`, a warning); its other scenes are saved with the project.
- **Each scene is a full node tree; models, textures, sounds, images and scripts are shared by the project.** The DS limits (texture memory, sprites, palettes...) are checked **per scene**: the
  ROM only holds one scene's assets at a time.
- **All scenes share the project's mode** (no mixing 2D and 3D).
- **Editor: tabs above the viewport** (click to edit, double-click a name to rename, "+ Scene", and on the open scene's tab Copy / Start here / Delete; the starting scene's tab is starred).

Choices I made (say if any is wrong):
- **File format compatible with every existing project:** `project.scene` stays the **starting scene's** tree; `scenes: [{ id, name, scene }]` holds the others; `sceneId` / `sceneName` name the starting scene. A
  project with one scene, named as its root node, writes none of them (byte-identical to before). Names are unique (scripts call scenes by name) and validated.
- **The switch happens when the frame ends**, and the new scene starts from scratch: its scripts' variables go back to their starting values, its `_ready` runs, its textures, sprites (sprite memory), sounds,
  touch areas and collision lists are loaded fresh and the old scene's are put away. The screen the 3D is on and the sprite VRAM bank follow the new scene.
- New scenes are empty (the mode's blank tree, named as the scene); Copy gives every node a new id and names the copy "Name2"; deleting the starting scene hands the start to the first scene left; a project
  always keeps at least one scene. Adding, renaming, deleting, copying and changing the start are undoable; **switching the scene being edited is not an edit** (undoing an edit opens the scene it was made in).
- Auto-complete offers `change_scene`; a name that isn't a scene is an error that lists the scenes (checked against the project's scenes in the editor's Script tab and by the compiler).

## Description
- Core (`project-scenes.ts`): `listScenes`, `withSceneEntries`, `withSceneTree`, `uniqueSceneName`, `getStartScene*`, `allSceneTrees`, `pruneUnusedAssets` (an asset any scene uses is kept). Persistence: schema + validator (unique names and ids, every scene's nodes checked).
- Language: `change_scene("name")` (`sceneCall`), `ScriptSceneContext.sceneNames`.
- Compiler: `translateProject3D` translates each scene as its own project (per-scene limits, diagnostics carry `sceneName`); scripts get per-scene names (`sc1_...`), a table `gs_scene_scripts` and a reset function per
  scene; `writeSceneDataC(scene, index)` per scene (`scene_data_<n>.c`), `writeSceneTableC`, `writeScriptCodeFileC`; `RomBuilder.buildScenes`; `compileProject` / `checkProject` use them.
- Runtime: `gs_scene` is now `(*gs_scene_current)` (a pointer chosen from `gs_scene_table`); `main.c`'s `enter_scene` sets a scene up (and `gs_leave_scene` puts the old one away); every init function frees what it
  allocated before; `gs_change_scene` sets `gs_pending_scene`.
- Editor: `activeSceneId`, `savedScenes` (unsaved = any scene's tree, name or place differs from the saved list, by reference), actions `SCENE_SWITCH/ADD/RENAME/DELETE/DUPLICATE/SET_START`, `savedProjectOf` (what Save, Export and Play use),
  `SceneTabs`, history entries carry the scene list.

## Notes (built and verified)
- Unit tests: `core/.../project-scenes.test.ts`, `script/script-scenes.test.ts`, `persistence/.../scenes-schema.test.ts`, `compiler/src/multiple-scenes.test.ts`, `ui/.../scene-edits.test.ts` (954 fast tests pass).
- **Emulator:** `compiler/src/testing/scenes.rom.test.ts`: a 3D project of three scenes, the first two switching by script after ten frames; after the run only the third scene's sprite is on the 2D
  screen (match 0.9993; the red and green sprites of the scenes left are gone). The existing sprite, animated-sprite, player-script and (mostly) touch-area emulator suites pass after the runtime refactor; two touch tests hit
  the known "Sending input to the emulator failed" flake.
- **Not verified:** the tab strip in the real app (no E2E script yet; the store behind it is unit-tested), scripts that switch back to an earlier scene (variable reset is generated and unit-tested, not run on the DS), and sounds
  playing across a switch. A 2D project has no switching.
