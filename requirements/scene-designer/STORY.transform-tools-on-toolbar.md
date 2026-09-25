---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.3d-editing-viewport-native-resolution.md, STORY.workspace-tabs-and-screen-filter.md, TASK.undo-redo-for-scene-edits.md, properties-panel/STORY.inspector-panel.md, project-menu/STORY.unsaved-changes-guard.md]
---

# Story: Select, Move, Rotate and Scale tools on the toolbar

## Context
Until now a 3D node's position, rotation and scale could only be changed by typing
numbers into the Inspector. Godot's toolbar has Select / Move / Rotate / Scale tools
that put a manipulator on the selected node in the viewport, and that is what makes
placing things in a scene practical.

## Description
A group of four tool buttons on the workspace toolbar, shown in 3D projects:
**Select (Q)**, **Move (W)**, **Rotate (E)**, **Scale (R)**. One is active at a time
(Select at first). While Move, Rotate or Scale is active, the selected node shows the
matching gizmo in the 3D viewport, and dragging a handle edits that node's position,
rotation or scale, with the Inspector following live.

- The Q/W/E/R keys switch tools (as in Godot), except while typing in a field.
- The gizmo appears only on a node that is actually drawn: visible, on the screen being
  shown. Selecting the scene root, or a node on the other screen, shows none.
- **Scale applies to meshes and grouping nodes only**, as elsewhere in the editor
  (a camera or light gizmo is never scaled). With Scale active and a camera or light
  selected, no gizmo is shown.
- Dragging a handle doesn't orbit the camera, and releasing it doesn't deselect the node.
- Clicking another node still selects it, whichever tool is active.
- The tool is editor state, not part of the project: it isn't saved and doesn't make the
  project look edited. Dragging does, like any other edit.
- 2D projects don't show the tools: 2D nodes only have a position, which is already
  edited by dragging their markers in the 2D viewport.

## Acceptance Criteria
```gherkin
Scenario: The tools are on the toolbar in a 3D project
  Given a 3D project is open
  Then the toolbar has Select, Move, Rotate and Scale buttons
  And Select is active
  And a 2D project's toolbar has none of them

Scenario: Choosing a tool
  When the Move button is clicked
  Then Move is the only active tool

Scenario: Keyboard shortcuts
  When W is pressed with no field focused
  Then Move is active (Q Select, E Rotate, R Scale likewise)
  When W is pressed while typing in an Inspector field
  Then the tool does not change

Scenario: Dragging the move gizmo changes position
  Given Move is active and a mesh is selected
  When its X handle is dragged
  Then the node's X position changes and its Y and Z do not
  And the Inspector shows the new value
  And the project shows unsaved changes

Scenario: Dragging the rotate gizmo changes rotation
  Given Rotate is active and a mesh is selected
  When a rotation ring is dragged
  Then the node's rotation changes about that axis

Scenario: Dragging the scale gizmo changes scale
  Given Scale is active and a mesh is selected
  When a scale handle is dragged
  Then the node's scale changes

Scenario: Select shows no gizmo
  Given Select is active
  Then no gizmo is shown on the selected node

Scenario: Cameras and lights aren't scaled
  Given Scale is active and a Camera3D is selected
  Then no gizmo is shown

Scenario: A gizmo drag doesn't orbit the view or lose the selection
  When a gizmo handle is dragged and released
  Then the viewpoint is unchanged
  And the node is still selected

Scenario: A nested node moves in its parent's space
  Given a mesh under a rotated, scaled parent
  When it is moved with the gizmo
  Then it follows the pointer and its stored position is relative to the parent

Scenario: Nothing to manipulate
  Given the scene root is selected
  Then no gizmo is shown whichever tool is active

Scenario: Switching tools alone is not an edit
  When a tool is chosen and no handle is dragged
  Then the project shows no unsaved changes
```

## Notes
- **Built and verified with real mouse input** (`tests/prototypes/e2e/transform-tools.mjs`, 10 checks,
  run three times): the script finds each gizmo handle by its color in a screenshot of the 3D canvas,
  presses on it, drags, and reads the Inspector. Covered: no tools in a 2D project; four tools in a 3D one
  with Select first and shortcut hints in their titles; choosing tools isn't an edit; Q/W/E/R (either case)
  switch tools and are ignored while typing in a number field; Select shows no gizmo and Move shows red,
  green and blue handles; dragging the X move handle changed only X, kept the node selected, marked the
  project unsaved, and did not orbit the camera (the far corner of the view was unchanged); dragging the
  blue ring changed only Z rotation; dragging the X scale handle changed only X scale; no gizmo on the scene
  root, no scale gizmo on a camera (which can still be moved); and a mesh under a parent turned 90 degrees
  and scaled 2x moved along the parent's local axis, with its stored position staying relative.
- **Bug found and fixed while building it:** the first version rendered the gizmo *inside* the node's
  transformed group. The controls update the object's transform, which updates its children, which included
  the controls: infinite recursion ("Maximum call stack size exceeded"). The gizmo now lives at the scene
  root; each drawn node registers its group in a map and the gizmo looks up the selected node's group
  (`SelectionGizmo` in `Viewport3D.tsx`). This also keeps a nested node's gizmo from being transformed twice.
- **Not exercised by the test:** dragging every handle (only the X move handle, the Z rotate ring and the X
  scale handle were dragged; the rest are the same three.js control), the yellow uniform-scale center
  handle, and the planar move handles. Shortcuts while a `<select>` has focus are ignored by design
  (untested).
- The tool is `activeTool` in the editor store, not part of the project. It stays as chosen when a project is
  closed and another opened in the same session.
- Move works in world axes and Rotate/Scale in the node's local axes (the Inspector's rotation and scale
  are local, and three.js scale is always local). A World/Local toggle is a natural follow-up.
- Not in this first cut: snapping (grid/angle steps), a world/local space toggle, and a
  multi-select. A drag is undoable as one step (`TASK.undo-redo-for-scene-edits.md`).
- Rotation is edited as the Euler angles (XYZ order, degrees) the project already stores.
  A big drag through 90 degrees on the Y ring can flip the other two angles to an
  equivalent triple; that's Euler behavior, not a bug.
