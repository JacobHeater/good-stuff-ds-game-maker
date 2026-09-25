---
status: in-progress
component: compiler
related: [SPIKE.compiler-toolchain-selection.md, STORY.compile-3d-scene-to-nds-rom.md, TASK.ds-scene-intermediate-representation.md, TASK.ds-runtime-c-template.md, TASK.rom-build-driver.md, STORY.compile-diagnostics-for-unsupported-content.md, STORY.export-rom-from-project-menu.md, STORY.compile-2d-scene-to-nds-rom.md, run-games-locally/SPIKE.emulator-selection-and-launch.md, run-games-locally/STORY.play-runs-rom-in-emulator.md, debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md, scene-designer/STORY.camera-light-and-material-properties.md, testing/TASK.compiler-and-rom-regression-tests.md, persistence/EPIC.project-persistence.md]
---

# Epic: Compile and export a real .nds ROM

## Context
Everything built so far authors a DS game *accurately* (scene model,
hardware budget, 2D and 3D viewports at native resolution) but nothing
turns a project into something a DS can run. The next goal is to close
that loop, and to use the attempt as a check on the editor itself: if a
saved project can be compiled into a real `.nds` file that runs in an
emulator and looks like what the editor showed, then the scene model and
the budget are honest; where it can't, that's a defect in what we built,
found early.

This is deliberately a **walking skeleton**, not "the compiler." The
first ROM only has to show the content the editor can already express.
That content is small: today the only real geometry is four built-in
primitives (cube, sphere, plane, cylinder) in 3D projects, and 2D nodes
have no image assets to draw. So the first milestone is 3D-only (see the
scope table below), and everything past it is a later Story.

## Narrative

**The pipeline.** A saved project becomes a ROM in five steps, each of
which is a separate ticket so it can be built and tested on its own:

```
.gsds project (ProjectSnapshot)
   │  1. diagnose  — reject or warn about what can't compile     (STORY.compile-diagnostics-for-unsupported-content)
   │  2. translate — flatten the tree, bake world transforms,
   │                 convert to DS fixed-point, emit vertex tables (TASK.ds-scene-intermediate-representation)
   │  3. assemble  — scene data + checked-in C runtime           (TASK.ds-runtime-c-template)
   │  4. build     — run the devkitARM/libnds toolchain          (TASK.rom-build-driver)
   ▼
game.nds  ──▶  5. run in a DS emulator                          (run-games-locally/*)
```

**Approach (provisional; confirmed or changed by the Spike).**
`SPIKE.compiler-toolchain-selection.md` holds the reasoning. In short:
shell out to the real DS homebrew toolchain (devkitPro's devkitARM +
libnds) rather than writing an ARM code generator, and make the compiler a
**data emitter feeding a hand-written C runtime** rather than a C source
generator. The compiler writes a constant scene table (transforms,
vertex lists, camera, lights) and a checked-in libnds program draws
whatever the table describes. That keeps generated code trivial, lets the
runtime be built and debugged once on its own, and lets the translation
step be a pure TypeScript function that's testable without any toolchain.
The cost was that scripting would need real code generation or an
interpreter; `scripting/SPIKE.scripting-language-approach.md` chose
generation: scripts compile to a C file beside the data tables
(`TASK.compile-scripts-to-c.md`), and the runtime gained a node table for them.

The toolchain is **detected, not bundled**: the user installs devkitPro,
and the app finds it (`DEVKITPRO`, then common install paths) and says
clearly what's missing when it can't.

**What can compile today.** This is the scope of the first milestone, and
it's set by what the scene model can express:

| Node kind | In a 3D DS scene | First milestone |
|---|---|---|
| `Node3D` | Grouping only; its transform is baked into its children at compile time | Yes |
| `MeshInstance3D` | cube / sphere / plane / cylinder as triangle lists | Yes |
| `Camera3D` | Projection + view. The model has no field of view, near/far or "which camera is active", so defaults are needed | Yes, with defaults |
| `DirectionalLight3D` | A DS hardware light; the DS has 4 | Yes (max 4) |
| `OmniLight3D` | The DS's fixed pipeline has no positional lights | Warn and skip |
| `CollisionShape3D` | Draws nothing; compiled with its shape and size so scripts can ask whether two overlap (`collision/EPIC.collision-shapes.md`); no physics | Yes, added after the first milestone |
| `AnimationPlayer` (offered in 3D projects) | Its animations, tracks and keys are built in and played by the runtime (`animation/EPIC.animation-player.md`) | Yes, added after the first milestone |
| `AudioStreamPlayer` (offered in 3D projects) | Compiled with its sound: `soundPlaySample` on the DS's sound hardware (see `TASK.compile-sounds.md`) | Yes, added after the first milestone |
| All 2D kinds | Need image assets that don't exist yet | Not in a 3D project; see `STORY.compile-2d-scene-to-nds-rom.md` |

**What the attempt turned up** (each has its own ticket). The first four
were editor defects, now fixed; the rest are open:
- **Fixed:** the hardware budget's triangle counts didn't match the geometry
  the viewport drew: a sphere was charged 480 triangles but drawn with 720, a
  cylinder 40 but drawn with 64.
  `debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`.
  There is now one definition of each primitive, in `@goodstuff/core`, that
  the viewport, the budget and the compiler all use.
- **Fixed:** the 3D viewport ignored a parent node's transform and
  visibility (it drew a flat list of nodes), so any nested scene looked
  different from what a ROM, and Godot, would show.
  `scene-designer/BUG.3d-viewport-ignores-parent-transforms.md`.
- **Fixed:** a directional light's rotation did nothing in the editor (it
  aimed the light from its position at the origin). Found because a
  UI-authored scene looked black in the editor and lit in the ROM.
  `scene-designer/BUG.directional-light-ignores-rotation.md`.
- **Fixed:** the editor couldn't create or change a mesh's primitive (every
  mesh added through the UI was a cube). The Inspector now has a Mesh selector;
  a UI-authored scene with all four shapes was compiled and run in melonDS.
  `scene-designer/STORY.choose-mesh-primitive.md`.
- **Open:** the FPS target is editor state, not saved in the project, so a
  compile can't know it and the caller has to supply one (60 by default).
  `scene-designer/TASK.save-fps-target-in-project.md`.
- A 3D scene can't say what a camera sees or how a mesh is colored: no
  field of view, no active-camera choice, no light color, no mesh color.
  And the editor's 3D viewport is an orbit camera at a fixed position with a
  fixed ambient light; it never shows the scene through a `Camera3D`, so
  nothing in the editor previews what the ROM will show.
  `scene-designer/STORY.camera-light-and-material-properties.md`. The first
  milestone uses fixed defaults, so this isn't blocking, but every mesh will
  come out the same grey, and "the ROM matches the editor" has to be judged
  against the scene's own camera, not the editor's orbit view
  (`STORY.compile-3d-scene-to-nds-rom.md` spells this out).
- The budget counts triangles only. The DS also limits vertices per frame
  (6144). With independent triangles the two limits coincide (3 × 2048), so
  the triangle limit is the one that binds and nothing needs to change yet,
  but that stops being true the moment strips or quads are used.

**Where the code lives.** A new workspace package, `@goodstuff/compiler`,
depending only on `@goodstuff/core`, holding the pure translation, the
diagnostics, and the build driver, with the C runtime under its
`runtime/` folder. Same shape as persistence: small ports (finding the
toolchain, running it) with a Node implementation and an in-memory or fake
one so the rest is testable without devkitPro installed.

**Out of scope for this Epic:** physics (collision shapes and overlap checks are built: `collision/EPIC.collision-shapes.md`), audio
playback beyond starting sounds and what scripts ask for (`TASK.compile-sounds.md`),
scripts (delivered separately: `TASK.compile-scripts-to-c.md`), 2D image asset import, saving to a cartridge or flashcard, and an
in-editor interpreted preview (`run-games-locally/SPIKE.game-runtime-approach.md`
recorded that the first milestone is the real ROM path).

## Acceptance Criteria (narrative)
The Epic is done when a user can take a 2D or 3D project built in this
editor, ask the app to build it, and get a `.nds` file that boots in a DS
emulator and shows the scene the editor showed: the same content, in the
same places, on the screen the project said. Content that can't be
compiled is reported before any build starts, by name, and is never
silently dropped. A missing toolchain is reported as a missing toolchain,
with what to install. Whatever the emulator shows was checked by an
automated test as well as by eye.

The **first milestone** (a subset of the above, `STORY.compile-3d-scene-to-nds-rom.md`)
is done when a 3D project containing primitives, a camera and a light
builds to a ROM that runs in an emulator and visibly matches the editor.

## Progress
**The first milestone is built and verified.** A 3D project compiles to a
real `.nds` that runs in melonDS at full speed and draws what the project
says. `pnpm --filter @goodstuff/compiler cli:build` then
`node packages/compiler/dist/cli.mjs compile <project.gsds | fixture:cube> <out.nds>`
does it from a terminal (about 4 seconds).

How it was checked: a project authored **through the real editor UI**
(`tests/prototypes/e2e/ui-to-rom.mjs`: two cubes, one nested under the other
so the UI itself produced a hierarchy, plus a camera and a light) was saved,
compiled, run in melonDS, and its top screen captured and compared with an
independent three.js render of the same project, built the way the editor's
viewport builds a scene. They agree, at an intersection-over-union of 0.91
(edges differ by about a pixel between the DS's rasterizer and ours). The same
comparison passes for a cube, one of each primitive, a nested scene with a
hidden branch, a scene on the bottom screen, and a scene at the full triangle
budget (169 cubes, 2028 triangles); two sensitivity checks confirm it fails
when it should (a different scene, a mirrored layout). `pnpm test` runs 96
fast unit tests (geometry, matrix math against three.js, fixed-point,
translation, diagnostics, the build driver with fakes); `pnpm test:rom` runs
the emulator tests and needs the toolchain, melonDS and a desktop. Deliberately
breaking the rotation order makes six tests fail.

**Now also in the app:** Project > "Export ROM..." compiles the project as the
editor has it (unsaved edits included), writes the `.nds`, and reports diagnostics
and the outcome in the Output log (`STORY.export-rom-from-project-menu.md`,
`STORY.compile-diagnostics-for-unsupported-content.md`; verified against the running
app by `tests/prototypes/e2e/export-rom.mjs`).

**And Play:** the toolbar's Play button builds the project and opens the ROM in melonDS
(`run-games-locally/STORY.play-runs-rom-in-emulator.md`; verified against the running app by
`tests/prototypes/e2e/play.mjs`).

**And imported models:** a mesh can be an `.obj` model imported into the project
(`scene-designer/STORY.import-obj-model.md`, `TASK.compile-imported-meshes.md`, both done). A UI-authored
project with two houses and a cube was compiled and run in melonDS and matches its reference render
(IoU 0.941).

**And textures:** a mesh can wear a PNG texture (`scene-designer/STORY.mesh-textures.md`,
`TASK.compile-textures.md`, both done): 16-bit textures uploaded at startup, texture coordinates per vertex, a
texture-memory check. A textured plane and cube were run in melonDS and sampled: every quadrant of the picture
is the source image's color, upright.

**And sound:** an `AudioStreamPlayer` with a sound compiles to constant sample data plus a player table
(`TASK.compile-sounds.md`, done; `audio/STORY.import-sound-and-audio-player.md`). The runtime calls libnds's `soundPlaySample` at
startup for every player with Autoplay on. It is measured on melonDS's own audio output (`sound.rom.test.ts`, 9 tests): the sound
plays and stops as it should, 50% volume reads exactly half the level of 100%, 2x pitch lasts half as long and 0.5x twice as long,
a loop keeps going, several players add up, and a sound of nearly 2 MB (the budget) plays beside the 3D scene.

**And lighting, now measured:** a scaled mesh used to ignore the lights entirely in the ROM, and a scene with no light
rendered black (`BUG.rom-lighting-breaks-on-scaled-meshes.md`, done). The DS transforms a normal by the same matrix as its
position and never renormalizes it, so the compiler now splits each mesh's transform into rotation + translation and a
separate scale, and the runtime applies the scale to positions only. Real ROMs at several angles, scales and intensities are
checked against the DS lighting formula in `@goodstuff/core` (`lighting.rom.test.ts`); directional lights have an intensity
(`scene-designer/STORY.directional-light-intensity.md`, the level of a white light, 31 steps).

Not done: 2D. Things that are built but not independently verified: 30 FPS pacing (built in, but melonDS's title reports
emulator speed, not the presentation rate, so it can't be measured that way).
