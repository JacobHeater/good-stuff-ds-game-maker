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
| 3D nodes assigned to both screens | Error: the DS drives 3D on one screen only |
| A value that doesn't fit the DS's fixed-point range | Error naming the node |
| A 2D project | Error: 2D compile isn't supported yet |
| `CollisionShape3D`, `AudioStreamPlayer` in a 3D project | No diagnostic: ignored by design, documented |

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

Scenario: Mixed screens are an error
  Given 3D nodes assigned to both screens
  Then compilation is refused and the message says 3D output is per single screen

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

Scenario: Ignored-by-design nodes stay quiet
  Given a 3D project containing a CollisionShape3D
  Then compiling produces no diagnostic about it
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
