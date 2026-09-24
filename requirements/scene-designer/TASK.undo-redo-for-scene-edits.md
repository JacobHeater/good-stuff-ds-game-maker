---
status: proposed
component: scene-designer
related: [EPIC.scene-designer.md, STORY.scene-menu-node-crud.md]
---

# Task: Undo/redo for scene edits

## Context
Every scene mutation (move node, add/delete/duplicate node, edit a
transform, toggle visibility, new scene) currently goes through a
single `useReducer` in `editor-store.tsx` with no history tracking. A
mis-click that deletes or drags the wrong node has no way to be undone
today, which is not acceptable for a tool meant to replace/complement
Godot for real scene-building work.

## Description
Add undo/redo support for scene-tree edits (node add/delete/duplicate/
move/transform-change/visibility-toggle, and new-scene resets), exposed
through standard keyboard shortcuts and, eventually, an "Editor" or
"Scene" menu entry.

## Acceptance Criteria
```gherkin
Scenario: Undo reverts the last scene edit
  Given a node was just moved, added, deleted, or had a property changed
  When the user triggers Undo
  Then the scene tree returns to its state before that edit
  And the previously selected node (if it still exists) is reselected

Scenario: Redo reapplies an undone edit
  Given an edit was just undone
  When the user triggers Redo
  Then the edit is reapplied
  And the scene tree matches its state right before the undo

Scenario: Undo history does not cross project boundaries
  Given edits were made in a project and it was then closed or another was opened
  When the user triggers Undo in the newly opened project
  Then nothing is undone, and the previous project's edits are never applied to it

Scenario: A new edit after undoing clears the stale redo stack
  Given the user has undone one or more edits
  When the user makes a new edit instead of redoing
  Then the previously-undone edits are no longer reachable via Redo
```

## Notes
- Consider whether every keystroke in a numeric Inspector field should
  be its own undo step, or whether transform edits should be
  debounced/committed on blur — undoing "one character typed" is
  usually not what users expect from Ctrl+Z. This is worth resolving
  before implementation, not left as an accidental side effect of
  whatever the reducer already does per-dispatch.
- **Interaction with unsaved-changes tracking.** "Unsaved" is currently
  `state.sceneRoot !== state.project.scene` (reference comparison; see
  `project-menu/STORY.unsaved-changes-guard.md`). Undoing back to the
  saved tree only reads as clean if undo restores the *same tree object*
  that was saved — so keep history as tree references (the reducer's
  trees are immutable), not deep copies, and it works for free; a deep
  copy would leave the project looking unsaved after undoing everything.
  Add a scenario for it when this is picked up.
