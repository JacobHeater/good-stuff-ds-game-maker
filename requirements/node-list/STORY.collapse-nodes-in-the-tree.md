---
status: done
component: node-list
related: [STORY.select-and-reorder-nodes.md, STORY.scene-tree-panel.md]
---

# Story: Fold a node's children away in the Scene tree

## Context
A scene with many blocks, sprites or a HUD makes a long tree. A node with three children can now be folded so its row stands for the whole group.

## Decisions
Choices I made without asking (say if any is wrong):
- **An arrow (▼ / ▶) on every row that has children** folds and unfolds it. A folded row shows how many nodes are hidden inside it (at any depth). Rows with no children have no arrow.
- **"Collapse all" (▶▶) and "Expand all" (▼▼)** in the tree's header fold or unfold every node at once. Collapse all leaves the scene root open, so the top level stays visible.
- **Folding is only how the tree looks.** It is not saved with the project, not an edit (no undo step, nothing "unsaved"), and a newly opened project starts unfolded.
- **Selection follows what is shown.** Folding a node takes the selected nodes inside it out of the selection; if the primary one was inside, the folded node becomes the primary. A Shift+click range
  runs over the rows that are shown (an anchor that got folded away counts as the row that stands for it).
- **Selecting a node that is inside a folded one from elsewhere** (a node just added, the viewport, an undo) **unfolds the way to it**, and only that way. Dropping nodes *into* a folded node
  opens it, so they are seen where they went. A deleted node is forgotten.
- Delete and Duplicate act on selected nodes as before; they never act on a node that is hidden inside a fold unless its folded parent is selected (which takes it along).

## Description
- State: `collapsedNodeIds` (`editor-store.tsx`), actions `TOGGLE_COLLAPSED`, `COLLAPSE_ALL`, `EXPAND_ALL`; helpers `visibleNodeIds`, `ancestorIds`, `nearestVisibleId`; `normalizeSelection` unfolds the way to
  a newly selected node and prunes gone ids.
- Panel: `SceneTreePanel` draws the arrow, the hidden count and the two header buttons, and does not render the children of a folded node.

## Acceptance Criteria
```gherkin
Scenario: A node with three children folds to one row
  Given Node2D with three children
  When its arrow is clicked, then only Node2D shows, with a count of 3
  And clicking it again shows the children

Scenario: Everything folds and unfolds at once
  When Collapse all is clicked, then every node that has children is folded except the scene root
  And Expand all unfolds them

Scenario: A fold is not an edit
  Then folding adds no undo step, and Ctrl+Z undoes the last real edit and leaves the folds alone

Scenario: The selection follows the fold
  Given a child of Node2D is selected
  When Node2D is folded, then Node2D is selected instead
  And selecting a node inside a folded node unfolds the way to it
```

## Verification
`state/collapse.test.ts` (12) and the folding check in `tests/prototypes/e2e/tree-select-reorder.mjs` (real clicks on the arrows and header buttons in the running app).

## Not built
Folding with the keyboard (the arrow keys nudge the selected node, so they are not used), remembering folds between sessions, folding by double-click, and unfolding a folded node while a drag hovers over it.
