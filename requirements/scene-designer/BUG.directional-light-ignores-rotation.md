---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, BUG.3d-viewport-ignores-parent-transforms.md, STORY.camera-light-and-material-properties.md, compiler/EPIC.compile-and-export-nds-rom.md, compiler/TASK.ds-scene-intermediate-representation.md]
---

# Bug: A directional light's rotation had no effect in the editor

## Context
Found by building a scene through the editor UI and compiling it. In
`Viewport3D` a `DirectionalLight3D` was drawn as a bare three.js
`directionalLight` at the node's position, and three.js aims a directional
light from its position toward its `target`, which defaults to the scene
origin. So the light's direction was "from where it is toward (0, 0, 0)",
and its **rotation was ignored**. A light at the origin, which is where every
newly added node starts, had no direction at all: the meshes lit only by the
viewport's fixed ambient light and looked nearly black, whatever rotation the
user set in the Inspector.

Godot, which this editor is modeled on, aims a directional light along its
node's local -Z axis, so rotating the node aims the light. The compiler does
the same when it translates a scene for the DS. The result was a scene that
looked unlit in the editor and lit in the ROM.

## Description
A `DirectionalLight3D` shines along its own local -Z axis: rotate the node,
and the light turns with it. (Its position doesn't matter to a directional
light, only where its gizmo is drawn.)

## Acceptance Criteria
```gherkin
Scenario: Rotating a directional light aims it
  Given a directional light and a mesh
  When the light's rotation is changed in the Inspector
  Then the lit side of the mesh in the viewport changes to match

Scenario: A light at the origin still lights the scene
  Given a directional light left at the origin with a non-zero rotation
  Then meshes are lit from that direction, not left dark

Scenario: The editor and the compiled ROM agree on direction
  Given the same light rotation
  Then the viewport and the compiler use the same direction: the node's local -Z axis in world space

Scenario: A parent's rotation turns the light too
  Given a directional light under a rotated Node3D
  Then it shines along its own -Z composed with the parent's rotation
```

## Notes
**Fixed** in `Viewport3D.tsx`: the light gets a `target` one unit along -Z
inside the node's transformed group, so its direction is the group's -Z. The
compiler's side of this was already defined
(`compiler/TASK.ds-scene-intermediate-representation.md`: "direction from the
node's rotation"). Verified by authoring a scene through the UI, whose
light has rotation (-50°, 30°, 0) at position (0, 0, 0): dark before, lit
after (see `tests/prototypes/e2e/ui-to-rom.mjs`).
