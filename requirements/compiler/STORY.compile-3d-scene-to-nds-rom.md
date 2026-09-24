---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, TASK.ds-scene-intermediate-representation.md, TASK.ds-runtime-c-template.md, TASK.rom-build-driver.md, STORY.compile-diagnostics-for-unsupported-content.md, run-games-locally/SPIKE.emulator-selection-and-launch.md, testing/TASK.compiler-and-rom-regression-tests.md, scene-designer/STORY.camera-light-and-material-properties.md]
---

# Story: Compile a 3D scene into a runnable DS ROM

## Context
The first milestone of the Epic, and the point of the exercise: a project
authored in this editor becomes a real `.nds` that runs in an emulator and
shows the scene. It's the walking skeleton that joins the three pieces
(translation, runtime, build driver) end to end, and the first time
anything the editor produced is checked against real DS behavior.

Scope is set by what the model can express (see the Epic's table): 3D
projects only, four primitives, a camera, up to four directional lights,
fixed default colors and a fixed default field of view.

**"Matches the editor" needs a definition.** The editor's 3D viewport is an
orbit camera at a fixed position with a fixed ambient light; `Camera3D`
nodes are only gizmos, and nothing in the editor shows what a game camera
sees. So the ROM is judged against the *scene's own* camera: the same
objects, in the same places and orientations relative to one another, seen
from the `Camera3D` the project contains, at the DS's 256×192, on the screen
the project names. Lighting will not be identical: the DS has no ambient
term the way the editor viewport does, and its lighting model is coarser.
Comparing the editor's orbit view against the ROM isn't the test.

## Description
Given a saved 3D project, produce a `.nds` file that, run in a DS emulator,
draws that project's visible meshes from its camera, lit by its lights, on
the screen it specifies, at its FPS target. Building goes through the
pipeline in the Epic; this story is the requirement on its output.

## Acceptance Criteria
```gherkin
Scenario: A 3D project builds to a ROM
  Given a saved 3D project with mesh nodes, a Camera3D and a DirectionalLight3D
  When it is compiled
  Then a .nds file is produced

Scenario: The ROM runs in an emulator and shows the scene
  Given that ROM
  When it is opened in a DS emulator
  Then the meshes are visible on the screen the project names
  And the other screen is not showing the 3D scene

Scenario: Each primitive is recognizable
  Given a project with one cube, one sphere, one cylinder and one plane
  Then each is visibly its own shape in the running ROM

Scenario: Placement follows the scene
  Given meshes at different positions, rotations and scales, some nested under Node3D parents
  Then in the running ROM they appear at the corresponding places, in the
    corresponding orientation and size, relative to each other and to the
    scene's camera

Scenario: Hidden nodes are not drawn
  Given a mesh with visible false
  Then it does not appear in the ROM

Scenario: Moving the camera changes the view
  Given the scene's Camera3D is moved and the project recompiled
  Then the running ROM's view changes accordingly

Scenario: Lights light the scene
  Given a DirectionalLight3D
  Then surfaces facing the light are visibly brighter than surfaces facing away

Scenario: The ROM holds the frame rate
  Given a scene within the hardware budget
  Then the running ROM does not visibly drop below the project's FPS target

Scenario: The build is repeatable
  Given the same project
  When it is compiled twice
  Then the scene data fed to the toolchain is identical

Scenario: Failure is reported, not swallowed
  Given a project that can't be compiled or a machine without the toolchain
  Then no ROM is produced and the reason is reported
    (STORY.compile-diagnostics-for-unsupported-content.md, TASK.rom-build-driver.md)
```

## Notes
**Done.** How each scenario was checked (all against the real emulator, melonDS 1.1):
- Builds to a ROM, runs, shows the scene on the named screen, primitives
  recognizable, placement following the scene including nested parents and a
  hidden node, holding 60/60 FPS: **automated** (`pnpm test:rom`, silhouette
  against an independent three.js render, IoU at least 0.85; the fixtures and a
  UI-authored project all pass, the UI one at 0.91).
- Moving the camera changes the view: covered implicitly (the reference render
  takes its camera from the project, and each fixture's camera is different); no
  test moves one camera and compares two ROMs.
- **Lights light the scene: checked by eye only.** A sphere lit from the upper
  left is brightest there, and tops are brighter than sides. The automated
  comparison is of silhouettes, which ignore shading, so it wouldn't notice a
  wrong light.
- Repeatable build: automated (byte-identical `scene_data.c`).
- Failure reported, not swallowed: automated with fakes; the CLI exits non-zero.
- The first pass was by eye; the automation came from
  `testing/TASK.compiler-and-rom-regression-tests.md`.
- Every mesh will be the same grey: the model has no colors
  (`scene-designer/STORY.camera-light-and-material-properties.md`). That's
  expected, and a reason "each primitive is recognizable" has to be judged by
  silhouette and shading rather than color.
- Findings from this work that change the editor (wrong triangle counts,
  missing camera and material properties) are already ticketed; new ones
  found while building this go in the Epic's findings list.
