---
status: done
component: debugger
related: [STORY.hardware-budget-report.md, scene-designer/STORY.3d-editing-viewport-native-resolution.md, compiler/EPIC.compile-and-export-nds-rom.md, compiler/TASK.ds-scene-intermediate-representation.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md]
---

# Bug: The triangle budget disagrees with the geometry the editor draws

## Context
Found while scoping the compiler, which has to choose one tessellation for
each primitive and report its real cost. The Hardware tab charges each
`MeshInstance3D` a fixed triangle count from `MESH_PRIMITIVE_TRIANGLE_COUNT`
(`packages/core/src/scene-node.ts`). The 3D viewport
(`packages/ui/src/editor/viewport/Viewport3D.tsx`) independently draws each
primitive with its own three.js geometry and its own segment counts. The two
were never tied together, and they differ. Measured by building each
geometry and counting its triangles:

| Primitive | Charged by the budget | Actually drawn by the viewport | Viewport geometry |
|---|---|---|---|
| cube | 12 | 12 | `boxGeometry(1, 1, 1)` |
| plane | 2 | 2 | `planeGeometry(1, 1)` |
| cylinder | 40 | **64** | `cylinderGeometry(0.5, 0.5, 1, 16)` |
| sphere | 480 | **720** | `sphereGeometry(0.5, 24, 16)` |

So the budget under-reports a sphere by a third and a cylinder by more than
a third. A scene near the limit can show as within budget while the shape the
user is looking at costs more than the report says. This contradicts the note
in `STORY.hardware-budget-report.md` that the estimate "is accurate today".

## Description
There should be exactly one definition of each primitive's geometry, in
`@goodstuff/core`, and the viewport, the budget, and the compiler must all
derive from it: the viewport builds what it draws from that definition, the
budget's count is computed from it, and the compiler emits it. Nothing else
carries a triangle count for a primitive.

Which counts are "right" is a decision, not a given: 720 triangles for a
sphere is a lot against a 2048-per-frame ceiling (two spheres and a cube
nearly fill it), and real DS games use far coarser spheres. Choosing a
DS-appropriate tessellation, and making the viewport draw the same one, is
part of the fix. The viewport is meant to be an honest picture of what the
hardware will draw, and it currently draws a more detailed sphere than the
DS could afford in quantity.

## Acceptance Criteria
```gherkin
Scenario: The budget counts what is drawn
  Given a MeshInstance3D of any primitive
  Then the triangles the budget charges for it equal the triangles the
    viewport draws for it

Scenario: One definition of each primitive
  Then the viewport, the budget and the compiler all obtain a primitive's
    geometry and triangle count from the same definition in @goodstuff/core
  And no other source file contains a per-primitive triangle count

Scenario: A test prevents drift
  When the viewport's geometry for a primitive is changed without changing the shared definition
  Then a test fails

Scenario: The chosen tessellations are DS-appropriate
  Then the sphere and cylinder tessellations are recorded here with the
    reason, and a scene of several spheres can fit the 2048-triangle ceiling

Scenario: The Hardware tab shows the corrected numbers
  Given a scene with one sphere
  Then the triangle budget shows the shared definition's sphere count, not 480
```

## Notes
**Fixed.** `packages/core/src/primitive-geometry.ts` is the one definition of each
primitive (a non-indexed triangle list with per-vertex normals, counter-clockwise
from outside). The viewport builds what it draws from it, `computeSceneBudget`
counts from it (ignoring the count stored in older saved files, so an old project
reports the right cost), the compiler emits it, and `MESH_PRIMITIVE_TRIANGLE_COUNT`
is gone. Chosen tessellations, with the reason: **sphere 12 segments by 8 rings =
168 triangles** and **cylinder 12 segments = 48 triangles**, both DS-appropriate
(several fit a 2048-triangle frame; the old drawn sphere, 720, didn't leave room
for anything else). Cube 12 and plane 2 are unchanged. 28 tests cover counts,
winding, outward normals, vertex range and that the budget ignores stored counts.
The plane now lies in XZ facing up in its own definition instead of being
rotated by the viewport.

- Fix before, or together with, `compiler/TASK.ds-scene-intermediate-representation.md`;
  otherwise the compiler either inherits the wrong number or introduces a
  third one.
- Custom mesh import (`scene-designer/SPIKE.custom-mesh-and-sprite-import.md`)
  will replace the primitives' fixed counts with real ones; this fix should
  leave a seam for that rather than hard-code four cases forever.
