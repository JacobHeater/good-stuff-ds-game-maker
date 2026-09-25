---
status: done
component: collision
related: [EPIC.collision-shapes.md, TASK.collision-shape-model-and-persistence.md, TASK.collision-shape-inspector-and-viewport.md, TASK.script-overlaps-check.md, TASK.compile-and-run-collision-checks.md, scripting/STORY.write-and-run-scripts.md, scene-designer/STORY.scene-menu-node-crud.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md]
---

# Story: Give a node a collision shape, and ask a script whether two shapes touch

## Context
See `EPIC.collision-shapes.md`. `CollisionShape3D` exists as a node kind and nothing else; scripts can't ask about touching.

## Decisions (made with the product owner)
- **Scope: shapes and overlap checks, no physics.** The DS has no physics library. Shapes are data you edit and see, they are built into
  the ROM, and a script can ask whether two overlap. What to do about it is the script's job.
- **Shapes: box, sphere, capsule and cylinder.**
- **Scripts ask each frame**: `if $Player.overlaps($Coin):` inside `_process`, with no new language features (no events yet).
- **The editor draws the shapes** as wireframes in the 3D viewport, like Godot's collision debug drawing.

Choices I made without asking (say if any is wrong):
- **Sizes follow Godot's defaults and meaning:** a box is a full width/height/depth (default 1 x 1 x 1); a sphere has a radius (0.5); a
  capsule has a radius (0.5) and a *total* height including its round ends (2); a cylinder has a radius (0.5) and a height (2). Capsules and
  cylinders stand along the node's own Y axis. A capsule's height can't be less than twice its radius (it is raised to fit).
- **The node's own scale, and its ancestors' scale, scale the shape**, exactly as they scale a mesh (so a shape under a mesh follows the
  mesh's size), including a different scale on each axis (a sphere scaled unevenly is an ellipsoid). Its rotation and position place it.
- **The check is exact for these shapes** (not a bounding-box approximation): two shapes overlap when they share any point.
- **`overlaps()` is on the shape node**, and both sides must be `CollisionShape3D` nodes: `$PlayerShape.overlaps($CoinShape)`, or
  `overlaps($CoinShape)` in a script attached to a shape. A shape usually sits under the mesh it belongs to, so it follows it.
- **A hidden shape (or one under a hidden node) never overlaps anything**, so `visible = false` on a shape is how a script turns one off.
- **A shape does nothing until a script asks about it**; the compiler warns about a shape no script checks.

## Description
- **The node:** a `CollisionShape3D` has a **Shape** (Box, Sphere, Capsule, Cylinder) and that shape's size fields, in its Inspector.
  A new one is a 1 x 1 x 1 box. It keeps every size when the shape is changed back and forth.
- **The viewport** draws each collision shape as a colored wireframe at the node's position, rotation and scale; clicking it selects the
  node; the Move, Rotate and Scale tools work on it like on a mesh.
- **Scripts:** `a.overlaps(b)` is true while shapes `a` and `b` overlap. `a` and `b` are `$Name` references or `self`.
- **The ROM:** every kept shape is compiled with its shape and size; the DS tests overlap exactly, with the shapes' current positions
  (a shape that a script moves, or that is under something a script moves, is followed).
- **The project file** stores a shape's settings on its node (`collision`), and rejects nonsense sizes.

## Acceptance Criteria
```gherkin
Scenario: A new collision shape is a unit box
  When a CollisionShape3D is added
  Then its Inspector shows Shape Box with size 1, 1, 1

Scenario: Editing a shape
  Given a CollisionShape3D is selected
  When the shape is changed to Sphere and the radius to 1.5
  Then the Inspector shows Sphere with radius 1.5 and the viewport draws a sphere of that size
  And changing the shape back to Box shows the box's earlier size
  And each edit is one undo step

Scenario: The viewport draws and selects shapes
  Given a project with a collision shape under a mesh
  Then the viewport draws its wireframe following the mesh's position and scale
  And clicking the wireframe selects the shape node

Scenario: Overlap in a real ROM
  Given a script that shows a flag only while $PlayerShape.overlaps($WallShape), and moves the player with the D-pad
  When the game runs on the DS and the player is walked into the wall
  Then the flag is shown exactly while the shapes overlap

Scenario: Overlap is exact for every pair of shapes
  Given any two of box, sphere, capsule and cylinder, at any rotation and (uneven) scale
  Then the DS says they overlap exactly when they do, except within a hair of touching

Scenario: Hidden shapes are off
  Given a shape that overlaps another
  When it is hidden
  Then overlaps() is false

Scenario: A shape nothing checks is reported
  Given a collision shape that no script passes to overlaps()
  Then Export ROM warns that it does nothing

Scenario: Only shapes can be checked
  Given a script calling $Coin.overlaps($Wall) where Coin is a MeshInstance3D
  Then the editor and the compiler report an error saying overlaps() works on CollisionShape3D nodes

Scenario: Shapes are saved
  Given a project with a capsule of radius 0.3 and height 1.4
  When it is saved, closed and reopened
  Then the shape and its size are unchanged
```

## Notes (design)
- 2D projects keep `CollisionShape2D` as a name only.
## Notes (built and verified)
- Delivered by the four tasks in `related` and by `properties-panel/STORY.rename-a-node.md` (found necessary on the way: nodes had no way to be renamed, and a
  script names another node with `$Name`, so several new shapes, which all start as `CollisionShape3D`, could not be told apart).
- The whole path was run through the editor: `tests/prototypes/e2e/collision-shapes.mjs` builds a player, a wall, a hidden flag, a camera and a light with shapes,
  writes and attaches the script, exports a ROM, and `GSDS_COLLISION_ROM_PROJECT=<path> pnpm test:rom` runs that project in melonDS with the D-pad held.
- Unit tests (about 540) pass in `pnpm test`; the emulator suites are listed in `TASK.compile-and-run-collision-checks.md`.
- Still out (see the Epic): physics, contact points and push-out, ray casts, layers, enter/exit events, mesh-shaped collision, and 2D collision.
