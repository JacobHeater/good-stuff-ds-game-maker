---
status: done
component: scene-designer
related: [STORY.3d-editing-viewport-native-resolution.md, EPIC.scene-designer.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, compiler/TASK.ds-scene-intermediate-representation.md, STORY.camera-light-and-material-properties.md]
---

# Bug: The 3D viewport ignores a parent's transform and visibility

## Context
Found while scoping the compiler, which has to say where a nested mesh ends
up. `Viewport3D` (`packages/ui/src/editor/viewport/Viewport3D.tsx`) draws
`flattenSceneTree(root)`, a flat list of every 3D node, each placed using
only its *own* transform. So:

- A mesh under a translated, rotated or scaled `Node3D` is drawn as if its
  parent were at the origin with no rotation and unit scale.
- A `Node3D` with `visible: false` hides only itself; its children stay on
  screen.

The scene tree, the Scene Tree panel and Godot (which this editor is modeled
on) all treat the tree as a hierarchy where a node's transform is relative to
its parent's. The Scene Tree shows nesting and the Inspector edits a local
transform, so the editor shows a hierarchy and draws something else. A
compiled ROM will follow the hierarchy, and it would look different from the
editor for any nested scene.

## Description
Draw the 3D scene as a hierarchy: each node's transform is relative to its
parent, and a hidden node hides its whole subtree. A `MeshInstance3D`,
`Camera3D` or light gizmo under a `Node3D` appears where the composed
transform puts it.

Rotation is Euler angles in degrees applied in three.js's default `XYZ`
order, and the compiler must use the same order.

## Acceptance Criteria
```gherkin
Scenario: A child inherits its parent's transform
  Given a MeshInstance3D under a Node3D that is translated, rotated and scaled
  Then the mesh is drawn at its own transform composed with the parent's

Scenario: Transforms compose through several levels
  Given nested Node3D parents
  Then each level's transform applies to everything beneath it

Scenario: A hidden parent hides its subtree
  Given a Node3D with visible false containing meshes
  Then none of those meshes are drawn

Scenario: A node's own transform is unchanged when it has no transformed parent
  Given a mesh under a Node3D at the origin with no rotation and unit scale
  Then it is drawn exactly where it was before this fix

Scenario: Selection still works on nested nodes
  When a nested mesh is clicked in the viewport
  Then that node is selected in the Scene Tree
```

## Notes
**Fixed** in `Viewport3D.tsx`: `SceneNodeView` renders the tree recursively, a
group per node, and a hidden node returns nothing (so its subtree is gone). Checked
by authoring through the UI a cube with a second cube nested under it (rotated,
scaled, offset) and looking at the result, and, independently, by the compiled ROM
matching a three.js hierarchy of the same project. There is no automated UI test
of the viewport itself.

- Only the screen a node is assigned to decides whether it appears in the
  active screen's view, as today; a child on a different screen than its
  parent is still filtered by its own `screen`.
- The compiler's world-transform baking
  (`compiler/TASK.ds-scene-intermediate-representation.md`) is the same
  composition; ideally both use one implementation in `@goodstuff/core`.
