---
status: done
component: run-games-locally
related: [STORY.play-button-stub.md, STORY.play-runs-rom-in-emulator.md, SPIKE.emulator-selection-and-launch.md, compiler/EPIC.compile-and-export-nds-rom.md, debugger/TASK.real-debug-session-support.md]
---

# Spike: How "Play" should actually run a game

## Context
"Run the game" could mean two very different things for this project,
and no decision has been made yet:

1. **In-editor interpreted preview** — reuse the existing scene tree
   and rendering (2D viewport, `Viewport3D`'s Three.js scene) to play
   the scene live inside the editor, the way Godot's own "run scene"
   button does, without producing a real DS binary. Faster to build,
   but it's a simulation, not the real hardware/toolchain.
2. **Real compiled ROM + emulator** — depends on the `compiler`
   component producing an actual `.nds` file, then launching it in a
   DS emulator (e.g. melonDS/DeSmuME) as a child process. Much closer
   to "what will actually ship," but blocked on the compiler existing
   at all, and adds an external emulator dependency.

These aren't mutually exclusive long-term (an interpreted preview for
fast iteration, a real ROM run for final verification), but the first
milestone needs to be chosen.

## Description
Investigate and recommend which approach (or staged combination) to
build first, and what the smallest useful first milestone looks like.
Consider: how much of the current domain model (`SceneNode`, hardware
budgets) already supports an interpreted preview vs. how much
compiler/toolchain work a real ROM path requires before anything runs
at all.

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the two approaches above
  Then a written recommendation exists for which to build first and why
  And it defines the smallest concrete milestone for "Play does something real"
  And it explicitly notes what becomes a Story/Task vs. what stays out of scope
```

## Notes
- Whichever approach is chosen first will shape
  `debugger/TASK.real-debug-session-support.md`, since "what can the
  Debugger tab inspect" depends entirely on whether the runtime is an
  in-process interpreted preview or an external emulator process.

## Decision
Made by the product owner rather than derived: **the first milestone is the
real path — a compiled `.nds` run in a DS emulator.** The reason is that
the point of building the compiler now is to validate what the editor
produces against actual DS behavior, which an in-editor simulation can't
do. So:
- **Smallest milestone for "Play does something real":** Play compiles the
  open project to a ROM and opens it in an emulator
  (`STORY.play-runs-rom-in-emulator.md`), which needs the compiler's 3D
  slice (`compiler/EPIC.compile-and-export-nds-rom.md`) and an emulator
  choice (`SPIKE.emulator-selection-and-launch.md`).
- **In-editor interpreted preview:** not started and not decided. It stays a
  possible later addition for fast iteration; nothing here rules it in or out.
- **Consequence for the Debugger tab:** it will be looking at an external
  emulator process, not an in-process runtime, which is the shape
  `debugger/TASK.real-debug-session-support.md` should plan for.
