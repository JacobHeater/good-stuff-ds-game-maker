---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, SPIKE.compiler-toolchain-selection.md, TASK.ds-scene-intermediate-representation.md, TASK.rom-build-driver.md]
---

# Task: The DS runtime program

## Context
The other half of the data-driven approach chosen in
`SPIKE.compiler-toolchain-selection.md`: a small C program, written once
and checked in, that draws whatever the generated `scene_data` table
describes. There is no per-project C in the pipeline; the compiler only
produces `scene_data.c` / `scene_data.h`
(`TASK.ds-scene-intermediate-representation.md`).

Lives under `packages/compiler/runtime/`, with the standard libnds
Makefile layout so that `make` produces a `.nds`.

## Description
A libnds program that:
- **Initializes the 3D engine** on the screen the scene names (top or
  bottom), powers on the geometry and rendering hardware, and sets the
  video mode and the other screen to something inert.
- **Sets up the projection and view** from the scene's camera, once.
- **Configures lights** from the scene's light table (at most four) and
  enables them on each polygon.
- **Draws each mesh**: loads the mesh's baked world matrix, then submits its
  primitive's triangle list from the shared vertex/normal tables as
  independent triangles with the mesh's color.
- **Paces frames** to the scene's 30 or 60 FPS target by waiting the right
  number of vertical blanks before swapping buffers.
- Contains **no scene logic**: no tree, no transform math, no branching on
  node kind. If it needs to know something, the table says it.

Also a **fallback scene** compiled in when no project data is supplied (one
lit cube), so the runtime can be built and run on its own, independently of
the compiler, which is what makes it debuggable in isolation.

## Acceptance Criteria
```gherkin
Scenario: The runtime builds on its own
  Given devkitPro is installed
  When the runtime is built with its fallback scene
  Then a .nds file is produced with no involvement from the compiler

Scenario: The fallback ROM shows a lit cube
  When that ROM runs in an emulator
  Then a lit cube is visible on the top screen

Scenario: It draws exactly what the scene data says
  Given generated scene data with N meshes
  When the ROM runs
  Then N meshes are drawn, each at its baked matrix, and nothing else

Scenario: It renders on the screen the scene names
  Given scene data naming the bottom screen
  Then the 3D scene appears on the bottom screen and not the top

Scenario: It honors the frame-rate target
  Given scene data with a target of 30 FPS
  Then the runtime presents a new frame every second vertical blank

Scenario: It stays within the per-frame limits
  Given scene data at the triangle budget
  Then every triangle is submitted without the runtime exceeding the DS
    geometry engine's per-frame polygon or vertex limits

Scenario: It has no scene logic
  Then the runtime source contains no node-kind checks and no
    transform composition
```

## Notes
**Implemented** in `packages/compiler/runtime` (`Makefile` adapted from libnds's
own, `include/scene.h`, `source/main.c`, and a committed `source/scene_data.c`
that is the cube fixture; a test keeps it identical to what the compiler
generates, so it can't drift). Verification, scenario by scenario:
- Builds on its own with no compiler involved: yes (`make` in a copy of the
  folder, 113 KB).
- Lit cube on the top screen: yes, in melonDS at 60/60 FPS.
- Draws exactly what the data says, at the baked matrices: yes, by silhouette
  comparison for a cube, all four primitives, a nested scene, a UI-authored
  scene and a 169-cube scene.
- Renders on the screen the scene names: yes, checked for the bottom screen.
- At the triangle budget: yes, 2028 of 2048 triangles, still 60/60.
- No scene logic: yes by construction (`main.c` has no node kinds or transform
  math); not enforced by a test.
- **30 FPS pacing: built (two vertical blanks per frame) but not independently
  verified.** melonDS's window title reports the emulator's speed, not how often
  the 3D scene is presented, so it reads `[60/60]` either way. A 30 FPS ROM is
  checked to build and draw correctly.
- The backdrop is a dark blue, not black, on purpose: it lets a picture of the
  emulator find the screen's edges.
- Vertex/normal tables are shared per primitive, not repeated per mesh, so
  ROM size grows with distinct primitives, not with instances.
- Out of scope: textures, sprites, input, audio, and any per-frame
  animation. The first ROM is a still frame drawn every frame.

## Update
The screen the scene names is now the project's 3D screen: the scene root's screen, chosen in New Project ("2D on top" puts 3D on the bottom) and changeable from the toolbar
(`scene-designer/STORY.choose-2d-screen-in-3d-project.md`). The runtime is unchanged: it already drove 3D on the named screen and left the other a black backdrop, which is where a
3D project's 2D nodes will be drawn once 2D is compiled.
