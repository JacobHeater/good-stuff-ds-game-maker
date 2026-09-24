---
status: proposed
component: scene-designer
related: [EPIC.scene-designer.md, STORY.scene-menu-node-crud.md, debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md, compiler/EPIC.compile-and-export-nds-rom.md, SPIKE.custom-mesh-and-sprite-import.md]
---

# Story: Choose which primitive a mesh is

## Context
Found by authoring a scene through the editor UI in order to compile it. The
model has four built-in primitives (`MeshPrimitive`: cube, sphere, plane,
cylinder), and the viewport, the hardware budget and the compiler all handle
all four. But nothing in the UI can pick one: "Add 3D Node > MeshInstance3D"
always creates a cube, and the Inspector only *displays* a mesh's primitive
("Mesh: cube"). So a user building a game in the editor can only ever place
cubes. The other three exist only in the sample scene, in saved files and in
the compiler's test fixtures.

## Description
Let the user choose a mesh's primitive: either an "Add MeshInstance3D" entry
per primitive in the Scene menu (Cube, Sphere, Plane, Cylinder), or a
primitive selector in the Inspector for the selected mesh, or both. Changing
it updates the viewport, the hardware budget (the triangle cost differs a
lot: 12, 2, 48, 168) and, on the next compile, the ROM.

Which of the two entry points is right is a UI decision to make when this is
picked up. The Inspector selector is the more useful one, since it also fixes
a mesh placed as a cube by mistake.

## Acceptance Criteria
```gherkin
Scenario: A mesh's primitive can be chosen
  Given a MeshInstance3D is selected
  Then the Inspector offers cube, sphere, plane and cylinder
  And choosing one changes the mesh in the viewport

Scenario: The budget follows the choice
  Given a mesh is changed from a cube to a sphere
  Then the Hardware tab's triangle count rises by the difference between their costs

Scenario: New meshes can start as any primitive
  When a MeshInstance3D is added
  Then the user can end up with any of the four primitives without leaving the Scene menu and the Inspector

Scenario: The choice is saved and reopened
  Given a project with a sphere mesh
  When it is saved and reopened
  Then the mesh is still a sphere

Scenario: The compiled ROM follows the choice
  Given a sphere mesh chosen in the editor
  When the project is compiled
  Then the ROM draws a sphere
```

## Notes
- This is the smallest way to make the compiler's four primitives reachable
  from the UI; real assets are `SPIKE.custom-mesh-and-sprite-import.md`.
- The stored `mesh.triangleCount` is redundant with the primitive (the budget
  and compiler recompute it). Keep it consistent when changing the primitive,
  or stop writing it when the format is next revised.
