---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, SPIKE.compiler-toolchain-selection.md, TASK.ds-runtime-c-template.md, STORY.compile-diagnostics-for-unsupported-content.md, debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md, scene-designer/STORY.camera-light-and-material-properties.md, testing/TASK.compiler-and-rom-regression-tests.md]
---

# Task: Translate a 3D project into a DS-ready scene description

## Context
The first stage of the pipeline that needs no DS toolchain at all: a pure
function from a saved 3D project to a plain-data description of exactly
what the DS runtime should draw, already in the DS's own number formats.
The runtime (`TASK.ds-runtime-c-template.md`) then contains no scene logic,
only "draw what this table says". Keeping this stage pure means it can be
built and tested on any machine, before devkitPro is installed, and
verified with ordinary unit tests.

Lives in a new package, `@goodstuff/compiler`, which depends only on
`@goodstuff/core`.

## Description
`translateScene3D(snapshot) → DsScene3D | diagnostics`, covering:

- **Selection.** Walk the scene tree in order. Skip nodes with `visible:
  false` and everything under them. (`CollisionShape3D` and
  `AudioStreamPlayer` were ignored at first; both compile now: see `collision/` and `TASK.compile-sounds.md`.) Anything that can't be represented is reported by
  `STORY.compile-diagnostics-for-unsupported-content.md`, not dropped here.
- **Baked world transforms.** Compose each mesh's translation, rotation and
  scale down through its `Node3D` ancestors into one world matrix, at
  compile time. The runtime therefore never uses the DS's matrix stack
  (which is only a few levels deep) and never has to agree with the editor
  about rotation order: the compiler is the only place that does. The
  Euler order and unit conventions must match what `Viewport3D` does
  (three.js: degrees, `XYZ` order), and the Spike records how these map onto
  the DS's fixed-point matrices.
- **DS number formats.** Matrices and translations as 20.12 fixed-point
  (`f32`), vertex coordinates as 4.12 (`v16`, roughly ±8), normals packed
  10-bit, colors as RGB15. Conversion is done here, in TypeScript, so it's
  deterministic and unit-testable.
- **Geometry.** Emit each distinct primitive's vertex and normal table once,
  and have each mesh instance reference a primitive plus its matrix. The
  tessellation comes from one shared definition in `@goodstuff/core` that the
  editor viewport and the hardware budget also use
  (`debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`);
  the compiler must not carry its own copy of the numbers.
- **Camera.** The active camera's world position and orientation as a view
  matrix, plus projection settings. Until cameras have properties
  (`scene-designer/STORY.camera-light-and-material-properties.md`) the
  compiler uses documented defaults, and there is exactly one active camera
  (the first `Camera3D` in tree order; none is an error).
- **Lights.** Up to four directional lights (direction from the node's
  rotation, default white). The DS has four hardware lights.
- **Screen.** Which physical screen shows the 3D scene, taken from the 3D
  nodes' `screen` field; the DS can only drive 3D output to one.
- **Frame rate.** The project's FPS target (30 or 60), which decides how
  many vertical blanks the runtime waits per frame.
- **Output for the build.** A serializer that writes a `DsScene3D` as the
  `scene_data.c` / `scene_data.h` the runtime compiles against (constant
  arrays, no logic).

## Acceptance Criteria
```gherkin
Scenario: A valid 3D project translates to a scene description
  Given a 3D project with meshes, one camera and one directional light
  When it is translated
  Then the result lists every visible mesh with its primitive and world matrix
  And it has one camera, the lights, the screen, and the frame-rate target

Scenario: World transforms are baked through parents
  Given a mesh under a Node3D that is translated, rotated and scaled
  When it is translated
  Then the mesh's matrix equals the parent's transform composed with its own
  And the runtime is never asked to compose transforms

Scenario: Hidden branches are omitted
  Given a Node3D with visible false containing meshes
  When the project is translated
  Then none of those meshes appear in the result

Scenario: Rotation order matches the editor
  Given a mesh rotated on more than one axis
  Then its baked orientation equals the three.js XYZ Euler result the
    editor viewport shows for the same node

Scenario: Fixed-point conversion is exact where it can be and bounded where not
  Then converting to 20.12 and 4.12 round-trips to within 1/4096
  And a value outside the representable range is reported as a diagnostic
    naming the node, never silently wrapped

Scenario: Geometry comes from the shared tessellation
  Then the triangle count the compiler emits for each primitive equals the
    count the hardware budget uses for it

Scenario: Translation is deterministic
  Given the same project
  When it is translated twice
  Then the results, and the generated scene_data files, are byte-identical

Scenario: Translation needs no toolchain
  Given a machine with no devkitPro installed
  Then translating a project and running this task's tests both succeed

Scenario: Generated scene data is data only
  Then scene_data.c contains constant arrays and no executable statements
    beyond initializers
```

## Notes
**Implemented** in `packages/compiler/src` (`translate-scene-3d.ts`,
`matrix.ts`, `fixed-point.ts`, `ds-scene.ts`, `scene-data-writer.ts`), 75
unit tests. Differences from the plan above worth knowing:
- The **frame rate is an option** (`fpsTarget`, default 60), not read from the
  project: the FPS target is editor state and isn't saved in the project file
  (`scene-designer/TASK.save-fps-target-in-project.md`).
- **World-transform composition is not shared with the viewport.** The viewport
  uses three.js's own scene graph; the compiler has its own matrix code. They're
  tied together by tests that check the compiler's matrices against three.js's
  (composition, parent-child, inverse, look-at), and by the emulator comparison.
- A **camera's scale is ignored** (a scaled camera would distort the projection),
  and the reference render matches that.
- **3D nodes on the same screen** is decided from the nodes that actually draw
  (meshes, the used camera, lights), not from `Node3D` groups.
- Negative zero is normalized out of the DS conversions, so equal scenes compare
  equal and print identically.
- Ordering: this depends on the tessellation being centralized, so do
  `debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`
  first (or in the same change).
- Which matrix layout and multiplication order libnds expects is a fact to
  confirm in the Spike's hello-cube step; record it there and test against it.
- The editor's viewport is an orbit camera plus a fixed ambient light; it
  does not show the scene through a `Camera3D`. So a correct translation can
  still "look different" from the editor; see
  `scene-designer/STORY.camera-light-and-material-properties.md`.
