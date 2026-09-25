---
status: done
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
Let the user choose a mesh's primitive. Changing it updates the viewport, the
hardware budget (the triangle cost differs a lot: 12, 2, 48, 168) and, on the
next compile, the ROM.

**Decision: a "Mesh" selector in the Inspector, and nothing new in the Scene
menu.** "Add MeshInstance3D" still adds a cube; choosing the primitive is a
second step in the Inspector. The Inspector selector is the one that's needed
either way (it also fixes a mesh added as a cube by mistake), and a Scene-menu
entry per primitive would only save one click while making the "Add 3D Node" list
longer. Revisit if adding shapes turns out to be a frequent, repetitive action.
Each option shows its triangle cost ("sphere (168 tris)"), so the price is visible
before choosing.

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
- **Built and verified** (`tests/prototypes/e2e/mesh-primitive.mjs`, 6 checks against the real
  app): the Inspector offers the four with costs; choosing a sphere redraws the viewport and
  moves the Hardware tab's count by exactly 156; changing back restores it; re-choosing the
  current primitive isn't treated as an edit; a scene with one of each costs 12 + 168 + 2 + 48;
  and after saving, closing and reopening each mesh is still its primitive. The saved project
  was then compiled and run in melonDS through `pnpm test:rom` (`GSDS_ROM_PROJECT`), and the
  emulator draws a cube, a sphere, a plane and a cylinder (IoU 0.933 against the reference).
  `pnpm test` also has a schema check (`mesh-primitive-schema.test.ts`) that every primitive
  in `MESH_PRIMITIVES` validates and round-trips, so the hand-authored JSON Schema can't drift
  from the list the editor offers.
- Later, `STORY.import-obj-model.md` extended this same selector with the project's imported models (listed
  after the four primitives, labelled "name (N tris, imported)").
- The list of primitives now lives once, as `MESH_PRIMITIVES` in `scene-node.ts`; the
  Inspector iterates it. (The JSON Schema still spells the four out, which is what the test guards.)
- A plane lies in the XZ plane and faces +Y, so it's edge-on to a camera at the same height and can
  look missing. Its back face is unlit on the DS (culling is off, so it's still drawn, but dark).
  The verification scene first rotated the plane the wrong way (-70 degrees about X, away from a camera at
  +Z), and the emulator showed a dark plane; +70 turns it toward the camera and it renders lit. Not a bug,
  but worth remembering when a shape looks dark or absent.
