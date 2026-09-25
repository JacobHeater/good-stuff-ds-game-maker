---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, TASK.ds-scene-intermediate-representation.md, STORY.compile-3d-scene-to-nds-rom.md, STORY.export-rom-from-project-menu.md, debugger/STORY.hardware-budget-report.md]
---

# Story: Say what can't be compiled, before building

## Context
The editor lets a user place things the DS can't draw, or that this
compiler can't yet: an `OmniLight3D` (the DS has no positional lights),
more than four lights, a scene with no camera, more triangles than the
hardware can push, a 2D project before 2D compile exists. The wrong
behaviors are to drop them silently (the ROM quietly looks wrong) or to
fail deep inside the C toolchain with an error about generated code. The
Epic's rule is that unsupported content is reported by name, up front.

## Description
A diagnostics pass, run before any file is generated or process started,
that produces a list of **errors** (no ROM is built) and **warnings** (a
ROM is built and the thing is left out), each naming the node and saying
what to do. Shown to the user in the Output log (and by the command-line
entry), so a compile is never a mystery.

| Situation | Severity |
|---|---|
| No `Camera3D` | Error |
| More than one `Camera3D` | Warning: the first in tree order is used |
| More than 4 directional lights | Error |
| `OmniLight3D` | Warning: skipped (no positional lights on the DS) |
| Total triangles over the hardware budget | Error, with the count and the limit |
| A visible 2D node on a 3D project's 2D screen (Label, Sprite2D, ...; not a plain Node2D group) | Warning: not drawn by the ROM yet (`two-d-node-not-built`) |
| A value that doesn't fit the DS's fixed-point range | Error naming the node |
| A 2D project | Error: 2D compile isn't supported yet |
| `CollisionShape3D` in a 3D project | Compiled (shape and size), no diagnostic when a script passes it to `overlaps()`; otherwise a warning (`collision-shape-unused`) |
| `AnimationPlayer` with no animations | Warning: left out (`player-without-animations`) |
| `AnimationPlayer` whose animations nothing starts | Warning: in the ROM, but no Autoplay and no script plays it (`animation-not-started`) |
| An animation track for a node that isn't in the game | Error (`animation-target-missing`) |
| `AudioStreamPlayer` with no sound | Warning: left out (`player-without-sound`) |
| `AudioStreamPlayer` naming a sound the project lacks | Error (`missing-sound`) |
| `AudioStreamPlayer` with Autoplay off | Warning: in the ROM, but nothing starts it (`sound-not-started`) |
| A pitch beyond the sound hardware's playback rate | Warning: limited (`sound-pitch-clamped`) |
| More than 16 players starting at once | Error (`too-many-sounds`) |
| Sounds over the 2 MB sound budget | Error, with the total and the limit (`sound-memory`) |

(An `AudioStreamPlayer` and a `CollisionShape3D` used to be in the "ignored by design" row; both compile now. See `compiler/TASK.compile-sounds.md` and `collision/TASK.compile-and-run-collision-checks.md`.)

## Acceptance Criteria
```gherkin
Scenario: A project with a missing camera is refused
  Given a 3D project with no Camera3D
  When it is compiled
  Then no build is started
  And the error says the project needs a camera

Scenario: An unsupported light is a warning, not silence
  Given a 3D project with an OmniLight3D
  When it is compiled
  Then a ROM is produced
  And a warning names that node and says it was skipped and why

Scenario: Too many lights is an error
  Given a 3D project with five DirectionalLight3D nodes
  Then compilation is refused and the error gives the limit of four

Scenario: Over-budget geometry is an error with numbers
  Given a scene whose triangles exceed the hardware limit
  Then compilation is refused
  And the message states the scene's count and the limit

Scenario: The project decides which screen has 3D
  Given a 3D project (its scene root records which screen the 3D engine drives)
  Then the ROM draws 3D on that screen whatever a node's own screen says; there is no "mixed screens" error (it was removed when the choice moved to the project)

Scenario: 2D nodes are not built yet
  Given a Label or Sprite2D on the project's 2D screen
  Then the ROM builds and a warning names the node and says the ROM doesn't draw 2D nodes yet

Scenario: A 2D project is refused clearly
  Given a 2D project
  When it is compiled
  Then the error says 2D compilation isn't supported yet

Scenario: Diagnostics precede any build work
  Given a project with an error
  Then no build directory is created and no toolchain process is started

Scenario: Diagnostics reach the user
  When a compile has errors or warnings
  Then each is shown in the Output log, naming its node
  And the command-line entry prints the same list and exits non-zero on errors

Scenario: Grouping nodes stay quiet
  Given a 3D project containing a Node3D with nothing under it
  Then compiling produces no diagnostic about it

Scenario: A collision shape nothing checks is reported
  Given a 3D project containing a CollisionShape3D that no script passes to overlaps()
  Then compiling succeeds with a warning naming it (collision-shape-unused)
```

## Notes
**Done.** Every row of the table above is produced, named by node, and tested
(`translate-scene-3d.test.ts`, `compile-report.test.ts`, `rom-builder.test.ts`);
diagnostics precede any build work. The command line prints them and exits
non-zero on errors, and "Export ROM..." shows them in the Output log
(`STORY.export-rom-from-project-menu.md`, checked in the running app).

- The triangle total must use the same tessellation the compiler emits
  (`debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`),
  or this check will approve scenes the runtime can't draw.
- Whether `OmniLight3D` should stay a warning or become an error is
  reasonable to revisit once it's seen in a real scene; a warning was chosen
  so an unrelated omni light doesn't block a compile.
