---
status: done
component: node-list
related: [STORY.scene-tree-panel.md, scene-designer/STORY.scene-menu-node-crud.md, scene-designer/TASK.undo-redo-for-scene-edits.md, scene-designer/STORY.choose-2d-screen-in-3d-project.md]
---

# Story: Select several nodes and reorder them in the Scene tree

## Context
The Scene tree selected one node at a time and had no way to change the order or the parents of nodes: to move a node you deleted it and made it again. With several
duplicated blocks or HUD sprites that was slow.

## Decisions (made with the product owner: "reordering, and shift and ctrl selecting")
Choices I made without asking (say if any is wrong):
- **Selection:** Ctrl+click (Cmd on a Mac) adds a row to the selection or takes it out; Shift+click selects every row between the last row clicked without Shift (the
  *anchor*) and this one, in tree order, replacing the rest of the selection (as a file manager does). A plain click goes back to one row. The row clicked last is the
  **primary** selection: the Inspector and the viewports work on it (the Inspector says how many nodes are selected).
- **What acts on the whole selection:** Delete / Backspace, Ctrl+D, Scene > Duplicate Node and Delete Node, and dragging in the tree. A node selected together with something
  under it is handled once (it goes along with its parent). The scene root can be selected but is never deleted, duplicated or moved.
- **Reordering is drag and drop** in the tree. Dropping on the top quarter of a row puts the nodes **before** it, the bottom quarter **after** it, the middle makes them its
  **last children** (the scene root only takes children). A drag of a selected row moves the whole selection, keeping its tree order; a drag of an unselected row selects and
  moves just that node. Moving keeps each node's own values (local position, rotation and scale).
- **Not allowed:** dropping a node into itself or something under it, next to the root, or where it already is (no undo step). **In a 3D project** a 2D node isn't nested
  under a 3D node, nor a 3D one under a 2D node (as when adding a node); the scene root and the sound and animation players take anything.
- **One undo step** for each Delete, Duplicate and move of a selection (the label says "Delete 3 nodes", "Move 2 nodes", ...). Undo goes back to a single selection.
- Duplicating a selection copies each top-most selected node next to its original (the copies numbered like a single duplicate: `B` -> `B2`) and selects the copies.

## Description
- State: `selectedNodeId` (primary), `extraSelectedIds` and `selectionAnchorId`; `normalizeSelection` drops nodes that are gone and clears the extras whenever the primary changes by
  anything other than a Ctrl/Shift click or a duplicate. Actions `SELECT_NODE_MODIFIED`, `DELETE_NODES`, `DUPLICATE_NODES`, `MOVE_NODES`.
- Core: `topMostNodes` and `moveSceneNodes` (`scene-node.ts`, pure): the drop rules above, ids kept, the original tree untouched, null when nothing would change.
- Scene tree: `SceneTreePanel` shows every selected row (the primary a little stronger), handles the modifier clicks, and draws the drop position (a line above or below a row, an
  outline for "inside"); rows that can't take the drop show nothing.

## Acceptance Criteria
```gherkin
Scenario: Ctrl and Shift select several rows
  Given the rows Node2D, Sprite2D, Camera2D and TileMap
  When Sprite2D is clicked and TileMap is Ctrl+clicked, then both are selected
  And Shift+click from Label to Camera2D selects every row from Label down to Camera2D

Scenario: The selection is deleted and duplicated together
  When Sprite2D and TileMap are selected and Delete is pressed, then both go, and one Ctrl+Z brings both back
  And Ctrl+D copies each next to its original and selects the copies

Scenario: Rows are moved by dragging
  When TileMap is dropped on the top edge of Sprite2D, it is before Sprite2D
  And on the middle of Node2D, it is Node2D's last child

Scenario: Some drops do nothing
  When Node2D is dropped onto its own child, or anything is dropped beside the scene root, nothing changes and no undo step is added
```

## Verification
`scene-move.test.ts` (core, 10), `state/multi-select.test.ts` (12) and `tests/prototypes/e2e/tree-select-reorder.mjs` in the real app (4 checks: real Ctrl and Shift clicks, real
Delete and Ctrl+D, and the DOM drag events a drag makes; the browser's own drag cannot be driven over CDP). **Not tried by hand:** a real mouse drag.

## Not built
Ctrl+A, keyboard reordering (Alt+arrows), collapsing branches, the Inspector editing several nodes at once, moving the selection with the arrow keys, dragging into or out of
the viewport, keeping a node's world transform when it changes parent.
