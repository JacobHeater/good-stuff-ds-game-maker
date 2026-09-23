---
status: proposed
component: run-games-locally
related: [STORY.play-button-stub.md, compiler, debugger/TASK.real-debug-session-support.md]
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
