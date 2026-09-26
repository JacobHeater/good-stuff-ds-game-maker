---
status: done
component: scripting
related: [../scene-designer/STORY.multiple-scenes.md, ../scene-designer/STORY.labels-and-text.md]
---

# Story: Game state that survives scenes, and a save file

## Context
Script variables (`var x = 0` at the top of a script) belong to one node and start over whenever its scene is loaded, so a score, lives or the level number vanished at every `change_scene`, and nothing
survived turning the console off. Second step of making the engine good enough for a full 3D game.

## Decisions (owner delegated; say if any is wrong)
- **`global var`.** `global var score = 0` at the top of any script makes a variable for the whole game: every script can read and write `score` by name (no `self.`, no declaring it again), in every scene, and it keeps its
  value when the scene changes. Numbers and bools, starting at a literal, like `var`. A script that only uses a global doesn't have to declare it, but one script somewhere must. Declared in several scripts, every
  declaration must say the same type and start value (an error naming both scripts). At most 64 globals. A global can't share a name with a script's own variable, a local, a parameter or a function.
- **A save file holds the globals.** `save_game()` writes every global; `load_game()` reads them back; `has_save()` says whether a valid save exists. All three are bools (true when it worked), so `if has_save(): load_game()` reads well.
  There is one save slot. The file records which globals the game has (a signature of their names and types) and a checksum, so a save from another version of the game, or a damaged one, is not loaded (false, nothing changes).
- **Where the file goes.** Homebrew has no cartridge save chip (and melonDS gives such ROMs none), so the file `gsds-<signature>.sav` is written to the SD card of a flash card, through libfat, next to the game. With no SD card it
  falls back to the cartridge's save memory (for a game on a real cartridge); with neither, `save_game()` is false.
- **Only in 3D projects**, which are the ones that run scripts.

## Description
- Core: `VarDecl.global`, `collectProjectGlobals` / `ProjectGlobal` (`script/globals.ts`), `ScriptSceneContext.globals`, resolution kinds `global` and `saveCall`; completion offers `global var`, the globals, and the three functions.
- Compiler: `DsScene3D.globals`; one `gs_global` table for the whole game (`writeScriptCodeFileC`), `gs_global_signature` (`globalSignature`); scripts read and write `gs_global[i]`, not their node's state; the three calls compile to `gs_save_game()` etc.
  A conflict between scripts is an error only for scripts some node uses.
- Runtime: `runtime/source/gs_save.c` (libfat file, EEPROM fallback), `gs_api.h`; the Makefile links `-lfat`.
- Editor: the script workspace checks and completes with the project's globals (the script being edited counts as written, the others as saved).

## Notes (built and verified)
- Unit tests: `core/src/script/script-globals.test.ts`, `compiler/src/game-state.test.ts`.
- Emulator: `compiler/src/testing/game-state.rom.test.ts` (melonDS): a global set in the first scene is read by the second scene (shown by a label), and a game saves, zeroes its score, loads, and shows the saved score. melonDS only has an SD card
  when its DLDI setting is on, so that test turns it on with a new image file and restores `melonDS.toml` afterwards. **A plain Play in melonDS has no SD card, so there `save_game()` is false** (turn on DLDI in melonDS's settings to try saving).
- **Not verified:** the cartridge-memory fallback, real flash-card hardware. **Not built:** several save slots, deleting a save, saving in 2D projects, arrays and other types, saving scene state (positions), a save on a timer.
