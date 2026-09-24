---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, TASK.ds-scene-intermediate-representation.md, TASK.ds-runtime-c-template.md, TASK.rom-build-driver.md, run-games-locally/SPIKE.emulator-selection-and-launch.md, run-games-locally/SPIKE.game-runtime-approach.md, scripting/SPIKE.scripting-language-approach.md]
---

# Spike: Compiler toolchain selection

## Context
Producing a real `.nds` needs some toolchain. There were three realistic
options, and the product owner has decided the project should attempt the
real thing now, as a check on what's been built (see the Epic), which
removes option 3 (defer) as the default. What remains is choosing between
1 and 2 and how to structure the compiler around the choice.

1. **Shell out to devkitPro (devkitARM + libnds)**, the standard,
   battle-tested DS homebrew toolchain that produces `.nds` files.
2. **A custom ARM9/ARM7 code generator and runtime.** Full control,
   enormous scope: close to writing a game engine's runtime and a
   backend from scratch.
3. **Defer real ROM export.** Now rejected: the point of this work is to
   validate the editor against real output.

## Description
Recommend an approach and the smallest ROM that proves it, and list what
still has to be confirmed by actually doing it.

### Recommendation (provisional)

**Option 1, with a data-driven runtime.** Two separate decisions:

*Use devkitPro.* libnds already exposes the DS's 3D hardware through an
OpenGL-like API (`glBegin`, `glVertex3v16`, `glTranslatef32`, `glLight`,
`gluPerspective`, and so on), so drawing meshes and a camera needs no
hardware-level code. Option 2 would mean re-deriving all of that for no
benefit this project cares about.

*Emit data, not C.* Two ways to use a C toolchain from a scene:
- **Generate C source** for each project (a `main()` with the drawing calls
  inlined). Flexible, but the compiler becomes a code generator whose bugs
  are C compile errors in code nobody wrote by hand, and every feature adds
  emitted C.
- **Emit a constant data table** (baked transforms, vertex lists, camera,
  lights) into a generated `scene_data.c`, and compile it against a
  **hand-written, checked-in C runtime** that draws whatever the table
  describes. *Recommended.* The runtime is written and debugged once,
  independently of the compiler; the translation step is a pure TypeScript
  function testable with no toolchain installed; and generated files are
  data, which is hard to get syntactically wrong.

The trade-off is scripting: game logic will eventually need either real
code generation or an interpreter inside the runtime. That's the scripting
Spike's question and is deliberately not decided here. Nothing about
emitting data now prevents adding either later.

**The toolchain is detected, not bundled.** The user installs devkitPro;
the build driver finds it (the `DEVKITPRO` environment variable, then the
usual install locations) and reports plainly when it can't. Bundling it
would mean redistributing a large multi-license toolchain and keeping it
current, for a first milestone that doesn't need that. (A Docker image of
devkitARM exists and is a possible later route for CI; not needed now.)

**The smallest ROM that proves it:** a scene with one cube, a camera and
one light, drawn on the top screen, built by the driver and run in an
emulator. That's `STORY.compile-3d-scene-to-nds-rom.md`.

### Suggested order of work
1. This Spike's empirical steps (below): the toolchain builds a
   hello-cube ROM by hand and it boots in an emulator.
2. `debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`
   (one tessellation, in one place) then
   `TASK.ds-scene-intermediate-representation.md`. These are pure
   TypeScript and need no toolchain, so they can start before step 1 is
   done.
3. `TASK.ds-runtime-c-template.md`, then `TASK.rom-build-driver.md`.
4. `STORY.compile-3d-scene-to-nds-rom.md`, `STORY.compile-diagnostics-for-unsupported-content.md`,
   `STORY.export-rom-from-project-menu.md`.
5. `run-games-locally/STORY.play-runs-rom-in-emulator.md`,
   `testing/TASK.compiler-and-rom-regression-tests.md`.
6. `STORY.compile-2d-scene-to-nds-rom.md` last: it needs real sprite
   assets (`scene-designer/SPIKE.custom-mesh-and-sprite-import.md`).

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the three options above
  Then a written recommendation exists on which to pursue
  And it states what should be scoped as a Story next

Scenario: The toolchain can be installed and located on the development machine
  Given a Windows machine with devkitPro installed
  Then devkitARM, libnds and the tool that packs a .nds file are present
  And the way they were found (environment variable or path) is recorded here
  # MET 2026-09-23: see Findings and tools/ds-toolchain/

Scenario: A hand-written hello-cube ROM builds
  Given a minimal libnds program that draws one lit cube on the top screen
  When it is built with the installed toolchain
  Then a .nds file is produced
  And the exact commands used are recorded here
  # MET: packages/compiler/runtime builds a lit cube (tools/ds-toolchain/make-rom.sh)

Scenario: The hello-cube ROM boots in an emulator
  Given that ROM
  When it is opened in the emulator chosen by run-games-locally/SPIKE.emulator-selection-and-launch.md
  Then the cube is visible on the top screen
  And the emulator's own reported problems, if any, are recorded here
  # MET: it runs in melonDS at 60/60 FPS with no problems reported

Scenario: The data-driven runtime is confirmed feasible
  Given the hello-cube program
  When its cube's transform and vertices are moved out of code into a constant table
  Then the same picture is produced
  Or the recommendation above is revised here with the reason

Scenario: Vertex and matrix conventions are pinned down
  Then this ticket records how the editor's Euler-angle rotations, unit-sized
    primitives and scale map onto the DS's fixed-point matrices and 16-bit
    vertex coordinates, so TASK.ds-scene-intermediate-representation.md has
    no open questions
```

## Findings (2026-09-23)
The toolchain and an emulator are now installed on the development machine
and verified, by `tools/ds-toolchain/` (see its README for the commands).

- **Installed:** devkitARM 16.1.0 (gcc), libnds, ndstool 2.3.1, grit, mmutil,
  and `make`, under `C:\msys64\opt\devkitpro`; melonDS 1.1 via winget. No
  admin rights were needed.
- **devkitPro's Windows installer can't be scripted.** `devkitProUpdater`
  is a GUI wizard; run with `/S` it exits 0 and installs nothing. What works
  is devkitPro's documented alternative: add its pacman repositories to an
  MSYS2 install and `pacman -S nds-dev`.
- **A ROM builds.** libnds's bundled `Simple_Tri` example builds to a 114 KB
  `hello3d.nds`. (This proves the toolchain; it is not yet the hand-written
  lit-cube program the Spike asks for.)
- **The ROM boots in melonDS** and draws its triangle on the top screen at
  the full 60 of 60 frames per second, with no BIOS or firmware files.
- **How the build has to be invoked** (the build driver's spec):
  - `DEVKITPRO` and `DEVKITARM` are **MSYS-side paths** (`/opt/devkitpro`,
    `/opt/devkitpro/devkitARM`), not Windows environment variables. A Windows
    lookup of `DEVKITPRO` finds nothing; look for `C:\msys64\opt\devkitpro`.
  - `devkit-env.sh` sets those variables but does **not** add the compilers to
    `PATH`; export `PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"`.
  - `make` and the ARM compiler are not on the Windows `PATH`. Run the build
    through `C:\msys64\usr\bin\bash.exe -l <script>`; inside it `/tmp` is
    `C:\msys64\tmp`.

**The data-driven runtime is confirmed feasible.** The C runtime
(`packages/compiler/runtime`) contains no scene logic and draws whatever a
generated `scene_data.c` describes; the compiler emits only constant arrays.
The recommendation stands unchanged.

**Conventions, pinned by building and looking** (each is checked by a test
or by the emulator comparison):
- **Matrices** are 16 `f32` (20.12 fixed point, 1.0 = 4096) values in
  **column-major** order, handed to `glLoadMatrix4x4` / `glMultMatrix4x4`
  as `(const m4x4 *)`. A camera centered in the picture is what confirmed the
  layout: a row-major matrix would have put it elsewhere.
- **Rotation** is Euler angles in degrees applied as `Rx · Ry · Rz` (three.js's
  default `XYZ`), and a node's transform is `T · R · S`. Checked against
  three.js's own matrices.
- **Vertices** are `v16` (4.12 fixed point, about ±8). Primitives are unit-sized
  and centered on the origin (0.5 is exactly 2048), and everything else is done
  with the matrix. A value that doesn't fit is a diagnostic, not a wrap.
- **Normals and light directions** are 10-bit signed fractions (`v10`), normals
  packed three to a word for `glNormal`.
- **The view** is the inverse of the camera's world transform with scale
  removed; the projection is `gluPerspective(fov, 256/192, near, far)` (fov 50°,
  as the editor's orbit camera).
- **Lights**: parallel only (there are four). A light's direction is the
  direction it *travels* (its local -Z), and it has to be set while only the
  view matrix is loaded, because the geometry engine transforms it by the
  current matrix at that moment. A sphere lit from the upper left is brightest
  at its upper left, which is what confirmed the sign.
- **Culling** is off for now (a plane is double-sided).
- **Known limitation:** normals are transformed by the same matrix as
  positions, so a non-uniformly scaled mesh is shaded wrongly. Not addressed.

## Notes
- Facts worth confirming rather than assuming, because the design leans on
  them: the DS has no positional lights (so `OmniLight3D` can't be drawn);
  the geometry engine takes 16-bit vertex coordinates in roughly the range
  ±8 (so meshes are unit-sized and everything else is done with the matrix);
  and the DS's per-frame limits are 2048 polygons and 6144 vertices.
- Independent triangles have no vertex sharing, so 2048 triangles is also
  exactly 6144 vertices; the triangle budget already in the editor is the
  binding one.
