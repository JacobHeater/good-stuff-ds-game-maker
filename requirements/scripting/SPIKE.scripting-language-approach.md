---
status: proposed
component: scripting
related: [EPIC.scripting.md, run-games-locally/SPIKE.game-runtime-approach.md]
---

# Spike: Scripting language and execution approach

## Context
Whatever language a user writes game logic in has to actually run
somewhere. Real DS homebrew is compiled C/C++ (devkitPro/libnds) —
there is no interpreter running on real DS hardware today the way
GDScript runs inside Godot's engine at runtime. This project could:

1. **Target an in-editor interpreted preview only** (see
   `run-games-locally/SPIKE.game-runtime-approach.md`) — pick any
   scripting language that's easy to embed in an Electron/Node
   process (JS/TS is the obvious candidate, since the whole stack is
   already TypeScript) and accept that it only runs in the editor's
   preview, not on real hardware, until/unless a real compiler exists.
2. **Design a small DSL that compiles down** to something that could
   eventually target real DS hardware via the future `compiler`
   component — much more DS-authentic, much more work, and coupled to
   decisions that component hasn't made yet either.
3. **Some staged combination**: start with an interpreted JS/TS-based
   scripting layer for the editor preview, and treat "real hardware
   compilation of scripts" as an explicitly separate, later problem
   that the `compiler` epic owns.

## Description
Investigate and recommend a starting approach, given the project is
TypeScript end-to-end and has no compiler toolchain yet. The
recommendation should be honest about what "scripting" means before a
real compiler exists — i.e., whether it's acceptable for an initial
version to only support the in-editor preview runtime.

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the three options above
  Then a written recommendation exists for the scripting language and
    execution model to start with
  And it states explicitly whether/how it depends on `compiler` or
    `run-games-locally` decisions
  And it defines what a minimal first Story would look like (e.g.
    "attach a JS function to a node's on-update event, runnable only
    in an in-editor preview")
```

## Notes
- This is tightly coupled to `run-games-locally/SPIKE.game-runtime-approach.md`
  — read both together, since "what language can scripts be written
  in" and "how does a game actually run" are really the same
  underlying architecture decision viewed from two components.
