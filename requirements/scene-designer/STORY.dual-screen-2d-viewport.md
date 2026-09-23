---
status: done
component: scene-designer
related: [EPIC.scene-designer.md]
---

# Story: Dual-screen 2D viewport

## Context
The Nintendo DS has two independent physical LCD screens (256×192
each), each with its own 2D engine and sprite (OAM) table. The 2D
editing surface needs to show both screens simultaneously (or
filtered to just one), matching Godot's 2D scene canvas but doubled
for the DS's dual-screen reality.

## Description
`DualScreenViewport` (`packages/ui/src/editor/viewport/DualScreenViewport.tsx`)
renders the current scene's 2D-visible nodes (`Sprite2D`,
`AnimatedSprite2D`, `Camera2D`, `Label`, `Area2D`) as small icon
markers on their assigned screen (`top` or `bottom`), at a fixed pixel
scale. Markers are draggable to reposition the node, and clicking a
screen's background selects the scene root.

## Acceptance Criteria
```gherkin
Scenario: Both screens render side by side by default
  Given the editor is on the "2D" workspace tab
  And the screen filter is set to "Both Screens"
  Then a "top screen" box and a "bottom screen" box are both visible

Scenario: Screen filter narrows to one screen
  Given the editor is on the "2D" workspace tab
  When the screen filter is set to "Top Screen"
  Then only the top screen box is visible

Scenario: Nodes render on their assigned screen only
  Given a Sprite2D node is assigned to the "bottom" screen
  Then it appears as a marker in the bottom screen box
  And it does not appear in the top screen box

Scenario: Dragging a marker updates the node's position
  Given a visible node marker in a screen box
  When the user drags the marker to a new location
  Then the node's stored X/Y position updates to match
  And the Inspector panel reflects the new position if that node is selected

Scenario: Clicking empty screen space selects the scene root
  Given a screen box with no marker under the pointer
  When the user clicks inside the screen box
  Then the scene root node becomes the selected node
```

## Notes
- Only `Sprite2D`, `AnimatedSprite2D`, `Camera2D`, `Label`, and
  `Area2D` render as visible markers (`VISUAL_KINDS` in
  `DualScreenViewport.tsx`); structural nodes like `Node2D` and
  `TileMap` do not render a marker (`TileMap` in particular has no
  visual representation yet — it's tracked in the model but not drawn).
