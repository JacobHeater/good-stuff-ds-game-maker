---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.scene-menu-node-crud.md, STORY.transform-tools-on-toolbar.md, STORY.import-obj-model.md, project-menu/STORY.unsaved-changes-guard.md]
---

# Task: Undo/redo for scene edits

## Context
Every scene mutation goes through a single reducer in `editor-store.tsx`. Until now
none of it could be undone: a mis-click that deletes the wrong node, or a stray drag of
a transform gizmo (`STORY.transform-tools-on-toolbar.md`), was permanent.

## Description
Undo and redo for **scene edits**, with **Ctrl+Z** to undo and **Ctrl+Shift+Z** to redo,
and matching Undo / Redo entries at the top of the Scene menu (which acts on the scene's
contents, so it's where they belong; see `project-menu/EPIC.project-menu.md`).

**What is undoable:** everything that edits the scene: add, delete and duplicate a node,
change a node's position / rotation / scale (from the Inspector, a gizmo, or dragging a 2D
marker), toggle visibility, change a mesh's source, import a model, texture or sound, and change an audio player's
sound, volume, pitch, autoplay or loop (a slider drag is one step). The history also holds the project's imported
sounds, so undoing an import takes the sound out of the project again. **What is not:**
editor settings and view state (the active tool, the screen filter, the FPS target, the
bottom tab, the selection on its own) and file operations (save, open, close, export,
play). Saving does not clear history: you can undo past a save, and the project then
reads as having unsaved changes.

**How:**
- History is a stack of references to the immutable scene trees (plus the project's
  imported models and the selection), not deep copies. That is what makes "undo back to
  the saved state" read as *no unsaved changes* for free, since unsaved is decided by
  comparing the current tree with the saved one by reference
  (`project-menu/STORY.unsaved-changes-guard.md`).
- **One undo step per gesture, not per event.** Dragging a gizmo handle sends an update for
  every frame, and typing "1.25" into an Inspector field sends one per keystroke; undoing
  "one character" or "one frame" is never what anyone wants. Consecutive edits of the same
  property of the same node that arrive within one second of each other are merged into a
  single step. Releasing a gizmo handle ends the gesture, so two separate drags are two
  steps even if they're less than a second apart.
- Each step has a label ("Move MeshInstance3D", "Delete Camera3D", ...), shown in the menu
  ("Undo Delete Camera3D") and in the Output log ("Undid: ...").
- Undo restores the selection as it was before the edit (so undoing a delete reselects the
  node it brings back), falling back to the scene root if that node no longer exists.
- An edit that changes nothing (typing the value a field already has, choosing the mesh a node
  already has) is not an edit: no history step and no "unsaved changes".
- History is capped at 200 steps, oldest dropped first.
- Ctrl+Z / Ctrl+Shift+Z also work while an Inspector number field has focus (that field is
  controlled by the editor, so the browser's own text undo would fight it). They do nothing
  while the unsaved-changes prompt is open, and on the startup view.

## Acceptance Criteria
```gherkin
Scenario: Undo reverts the last scene edit
  Given a node was just moved, added, deleted, or had a property changed
  When the user presses Ctrl+Z
  Then the scene tree returns to its state before that edit
  And the previously selected node (if it still exists) is reselected

Scenario: Redo reapplies an undone edit
  Given an edit was just undone
  When the user presses Ctrl+Shift+Z
  Then the edit is reapplied
  And the scene tree matches its state right before the undo

Scenario: A new edit after undoing clears the stale redo stack
  Given the user has undone one or more edits
  When the user makes a new edit instead of redoing
  Then the previously-undone edits are no longer reachable via Redo

Scenario: Undo history does not cross project boundaries
  Given edits were made in a project and it was then closed or another was opened
  When the user presses Ctrl+Z in the newly opened project
  Then nothing is undone, and the previous project's edits are never applied to it

Scenario: Undoing back to the saved state reads as clean
  Given a project was saved and then edited
  When the edit is undone
  Then the project shows no unsaved changes
  And redoing it shows unsaved changes again

Scenario: A save does not clear history
  Given an edit was made and the project saved
  When the user presses Ctrl+Z
  Then the edit is undone and the project shows unsaved changes

Scenario: A drag is one step
  Given a transform gizmo handle is dragged and released
  When the user presses Ctrl+Z once
  Then the node is back where it was before the drag began

Scenario: Typing in a field is one step
  Given "1.25" was typed into an Inspector position field
  When the user presses Ctrl+Z once
  Then the field shows its value from before the typing began

Scenario: Two separate drags are two steps
  Given two drags of the same handle a moment apart
  Then Ctrl+Z undoes only the second

Scenario: Deleting and importing are undoable
  Given a node was deleted, or a model was imported
  When the user presses Ctrl+Z
  Then the node is back and selected, or the model's node is gone and the model is out of the project

Scenario: Menu entries show what they'll do
  Given an edit that can be undone
  Then the Scene menu's Undo entry is enabled and names it, with Ctrl+Z beside it
  And when there is nothing to undo or redo the entries are disabled

Scenario: Non-edits are not undoable
  When the tool, screen filter or FPS target is changed
  Then Undo does not revert it and offers nothing to undo

Scenario: A no-op edit leaves no step
  When the value a field already holds is typed into it
  Then there is nothing to undo and the project does not show unsaved changes

Scenario: History is bounded
  Given more than 200 edits
  Then only the most recent 200 can be undone
```

## Notes
- **Built and verified.** `pnpm test` (27 new tests: `edit-history.test.ts` for the pure bookkeeping,
  `undo-redo.test.ts` running real actions through `editorReducer`, including the saved-state cleanliness rules,
  merging, non-edits, import, project boundaries and the startup view) and `tests/prototypes/e2e/undo-redo.mjs`
  (13 checks with **real keyboard and mouse input**, run twice): Ctrl+Z / Ctrl+Shift+Z on the startup view do
  nothing; the Scene menu shows both entries with their shortcuts, disabled on a fresh project and naming the edit
  ("Undo Add MeshInstance3D") otherwise; undo/redo of an added node with its selection; a new edit clears redo;
  typing "1.25" into a focused Inspector field is one step and Ctrl+Z works inside the field; undoing back to the
  saved scene shows no unsaved changes, saving keeps history, and undoing past it reads as dirty; a real gizmo drag is
  one step and two quick drags are two; a deleted node returns selected; importing a model can be undone and redone
  and the saved file loses and regains the model; choosing a tool isn't undone; the menu entries work; Ctrl+Z is
  ignored behind the unsaved-changes prompt; and a new project starts with nothing to undo.
- Where: `packages/ui/src/editor/state/edit-history.ts` (pure), `editorReducer` in `editor-store.tsx` (wraps the
  old reducer, now `applyAction`), the shortcut listener in `EditorStoreProvider`, and the Undo/Redo entries in
  `SceneMenu.tsx`. Steps that get recorded are listed in `describeEdit`; everything else is left out on purpose.
- Two behaviors that changed as a side effect, both for the better: setting a position or transform to the value it
  already holds is now a no-op (previously it created a new tree and marked the project unsaved), and the gizmo
  and the 2D marker call `endEditGesture` when released.
- Merge rule: same node and same property, less than one second apart (a sliding window). A drag that pauses for
  over a second with the button held becomes two steps. The 1 s window is `MERGE_WINDOW_MS`.
- **Not verified / limits:** Cmd+Z on macOS (the handler accepts `metaKey`, but nothing here runs on a Mac); dragging
  2D markers has unit-test coverage of the merging but no real-mouse E2E; the redo shortcut is only Ctrl+Shift+Z
  (no Ctrl+Y); no history panel.
- Undo is per open project and per session: history isn't saved in the project file.
- Not in this first cut: a visible history panel, Ctrl+Y as an extra redo shortcut, and
  undo for gizmo drags that pause for more than a second with the button held (that
  becomes two steps).
