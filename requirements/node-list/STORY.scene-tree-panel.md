---
status: done
component: node-list
related: [scene-designer/EPIC.scene-designer.md, properties-panel]
---

# Story: Scene Tree panel

## Context
Godot's "Scene dock" (commonly called the node tree) lists every node
in the currently open scene as an indented tree, and is the primary
way to select a node for editing. `SceneTreePanel`
(`packages/ui/src/editor/panels/SceneTreePanel.tsx`) is that
equivalent, docked in the left sidebar above the FileSystem panel.

## Description
Render the current scene's node tree recursively, indented by depth,
each row showing the node's kind icon, name, a screen badge
(`top`/`bottom`), and a visibility toggle button. Clicking a row
selects that node; the currently selected node is visually
highlighted.

## Acceptance Criteria
```gherkin
Scenario: The tree renders every node, indented by depth
  Given a scene with a root node and nested children
  Then every node appears as a row in the Scene Tree panel
  And each child row is indented further than its parent

Scenario: Each row shows kind icon, name, and screen badge
  Given a node named "Player" of kind "Sprite2D" assigned to the "top" screen
  Then its row shows the Sprite2D icon, the text "Player", and a "top" badge

Scenario: Clicking a row selects that node
  Given the Scene Tree panel is visible
  When the user clicks a node's row
  Then that node becomes the selected node
  And the row is visually highlighted to indicate selection

Scenario: The visibility toggle button flips a node's visible flag
  Given a node's row with a visibility toggle button
  When the user clicks the visibility toggle button
  Then the node's `visible` flag flips
  And the button's icon updates to reflect the new state
  And clicking the toggle does not also select the row's node
```

## Notes
- Selection state and the tree data itself are both owned by the
  shared editor store (`editor-store.tsx`), not by this panel — this
  panel is a pure view over that state, same as the viewports and the
  Inspector.
