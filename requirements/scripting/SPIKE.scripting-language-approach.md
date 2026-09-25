---
status: done
component: scripting
related: [EPIC.scripting.md, STORY.write-and-run-scripts.md, TASK.script-language-front-end.md, run-games-locally/SPIKE.game-runtime-approach.md, compiler/EPIC.compile-and-export-nds-rom.md]
---

# Spike: Scripting language and execution approach

## Context
Whatever language a user writes game logic in has to actually run somewhere. Real DS homebrew is compiled C/C++
(devkitPro/libnds); there is no interpreter on real DS hardware the way GDScript runs inside Godot's engine. Three
directions were on the table: an interpreted language that only runs in an in-editor preview; a small language that
compiles down for the DS; or a staged combination.

`run-games-locally/SPIKE.game-runtime-approach.md` already settled the first half of this: **the first milestone is a real
compiled ROM run in an emulator**, and an in-editor interpreted preview is deliberately not part of it. So scripts must run
on the DS itself.

## Decision
Made by the product owner (asked with the alternatives below), not derived:
- **Execution: compile to C.** The compiler translates scripts to C that is built into the ROM with the runtime. It is the fastest
  option on the DS's 67 MHz CPU and it is real DS code. The cost: script mistakes must be caught by our own checker (with
  line/column messages), because a gcc error inside generated code would mean nothing to a script author.
  Rejected: a bytecode VM in the ROM (sandboxed and debuggable, but slower and a second runtime to write), and visual
  event blocks with no language (simplest, but too limited to be the answer).
- **Language: GDScript-like.** Indentation-based, small and statically checkable, familiar from the Godot editor this app is
  modeled on. Rejected: a TypeScript subset (a restricted subset that maps to C needs a careful type checker and surprises
  people expecting all of TypeScript) and a C-like custom language.
- **First slice:** per-frame updates, buttons and touch input, moving and rotating nodes (position, rotation, scale, visibility),
  and playing sounds. (`STORY.write-and-run-scripts.md`)
- **Storage and editing:** scripts are **embedded in the project file** like models, textures and sounds, attached to a node from the
  Inspector, and edited in the Script tab with a real code editor (syntax colors, error underlines).

Consequences worked out while designing it (each is in a ticket):
- **The runtime can no longer bake every transform.** Until now it drew constant matrices with no hierarchy. Scripts move nodes, so the
  runtime gets a node table and composes transforms each frame, but only for nodes a script can change and their descendants;
  everything else keeps its baked matrix, so existing scenes render exactly as before
  (`compiler/TASK.runtime-node-table-and-script-services.md`).
- **`float` is fixed point.** The ARM9 has no FPU, so a script `float` is the DS's own 20.12 fixed-point number (range about
  +-524288, step 1/4096), not a C `float`.
- **The editor does not run scripts.** Play builds the ROM and runs it in the emulator, as for everything else; a script's errors are
  found by the checker in the editor, not by running it.
- **Testing on the target:** there is no host C compiler on the development machine, so generated code is verified by running it on
  the real ARM code in melonDS (`compiler/TASK.compile-scripts-to-c.md`).

## Acceptance Criteria
```gherkin
Scenario: The spike produces a written recommendation
  Given the three options
  Then a decision exists for the scripting language and execution model
  And it states how it depends on the compiler and run-games-locally decisions
  And it defines the first Story
```
