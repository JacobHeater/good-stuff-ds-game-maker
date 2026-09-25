---
status: done
component: collision
related: [STORY.collision-shapes-and-overlap-checks.md, TASK.collision-shape-model-and-persistence.md, properties-panel/STORY.inspector-panel.md, scene-designer/STORY.3d-editing-viewport-native-resolution.md, scene-designer/STORY.transform-tools-on-toolbar.md, scene-designer/TASK.undo-redo-for-scene-edits.md]
---

# Task: Edit a collision shape in the Inspector and see it in the 3D viewport

## Context
`STORY.collision-shapes-and-overlap-checks.md`.

## Description
**Inspector** (a `CollisionShape3D`, below the Position/Rotation/Scale fields): a **Shape** select (Box, Sphere, Capsule, Cylinder) and
the fields of that shape: **Size X / Y / Z** for a box, **Radius** for the round ones, **Height** for a capsule and a cylinder. Typing is
merged into one undo step per pause per field; changing the shape is its own step. Changing a shape's radius or height keeps a capsule at
least as tall as it is wide. A one-line hint says the shape does nothing until a script passes it to `overlaps()`.

**Viewport** (3D projects): every collision shape is drawn as a wireframe (a box's twelve edges; a sphere's three great circles; a
capsule's and a cylinder's rings and side lines), in a color that doesn't look like a mesh, brighter when selected, at the node's
position, rotation and scale (its own and its ancestors'), so it follows a mesh it is under. A faint fill makes it clickable: clicking selects
the node. The Move, Rotate and Scale tools work on it (scale multiplies the shape, as in the ROM). Like other nodes it isn't drawn when
hidden or assigned to the other screen.

## Acceptance Criteria
```gherkin
Scenario: The fields follow the shape
  Given a CollisionShape3D is selected
  Then a box shows Size X, Y and Z; a sphere shows Radius; a capsule and a cylinder show Radius and Height

Scenario: Edits are undoable steps
  When the radius is typed over several keystrokes
  Then one Ctrl+Z restores the radius from before the typing
  And changing the shape is a separate step

Scenario: The capsule stays a capsule
  Given a capsule of radius 0.5 and height 2
  When the radius is set to 1.5
  Then the height becomes 3

Scenario: Other nodes have no shape fields
  Given a MeshInstance3D is selected
  Then the Inspector has no Shape field

Scenario: The wireframe follows the node
  Given a collision shape under a mesh scaled to 2
  Then the drawn wireframe is twice its unscaled size and moves with the mesh
```

## Notes (built and verified)
- `panels/CollisionShapeField.tsx` (the Shape select and the size fields, each number keeping its own text while it has focus so `0.` on the way to `0.5` is not
  clamped to 0.01 mid-keystroke), the `SET_COLLISION_SHAPE` action in the store (9 tests in `collision-edits.test.ts`), and `viewport/collision-wireframe.ts`
  (pure line data, 5 tests) drawn by `CollisionShapeView` in `Viewport3D.tsx`. The Move, Rotate and Scale tools work on a shape (Scale multiplies the shape, as it
  does in the ROM; the node's own scale counts as well as its parents').
- `tests/prototypes/e2e/collision-shapes.mjs` (9 checks in the real app): the defaults, the fields following the shape, typing 1.5 without it being clamped
  half way, undo/redo as one step per number and one per shape change, the wireframe read from screenshots (teal when unselected, blue and larger when
  selected, gone when hidden), clicking the shape in the viewport selecting its node, and save/close/reopen.
- The wireframe renders lighter than its hex color (about 128, 208, 200); that is how the viewport's color handling treats every material and is not specific to shapes.
- Not done: a menu toggle to hide all collision shapes in the viewport (they are always drawn, as a hidden node is the only way to hide one).
