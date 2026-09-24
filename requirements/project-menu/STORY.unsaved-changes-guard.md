---
status: done
component: project-menu
related: [EPIC.project-menu.md, STORY.project-lifecycle-actions.md, persistence/TASK.persist-scene-to-project-file.md, scene-designer/TASK.undo-redo-for-scene-edits.md]
---

# Story: Warn before discarding unsaved changes

## Context
Before this story, choosing "Open Project..." or "Close Project"
replaced the open project immediately. The editor has no notion of "unsaved changes": the store
holds `project` (as last saved or opened) and `sceneRoot` (as currently
edited), but nothing compares them, so there's no way to know an edit
would be lost. A user who adds ten nodes and then hits Close Project
loses them silently. Quitting the app has the same gap.

This isn't new with the Project menu — it was true when those actions
lived in the Scene menu — but it is the most consequential thing the
project-file actions are missing, so it's ticketed here rather than left
implicit.

## Description
Track whether the open project has unsaved edits, and when an action
would discard them (Open Project, Close Project, and closing the app
window), ask the user first: **Save**, **Don't Save**, or **Cancel**.
The status bar (or window title) also shows when the project has unsaved
edits.

Open decision, to settle when this is picked up: how "unsaved" is
computed. A `dirty` flag set by every scene-editing action is cheap but
must be kept in step with each new action; comparing `sceneRoot` to
`project.scene` by reference is automatic (the reducer always produces a
new tree on edit) but reports "dirty" for an edit that was later
manually reverted. Undo/redo (`scene-designer/TASK.undo-redo-for-scene-edits.md`)
interacts with either choice.

## Acceptance Criteria
```gherkin
Scenario: A project with no edits closes without a prompt
  Given a project was just opened or saved and not edited since
  When "Close Project" or "Open Project..." is chosen
  Then no confirmation is shown

Scenario: Closing with unsaved edits asks first
  Given a project has unsaved edits
  When "Close Project" is chosen
  Then the user is asked to Save, Don't Save, or Cancel

Scenario: Save then proceed
  Given the unsaved-changes prompt is showing
  When the user chooses Save
  Then the project is saved and the original action then proceeds

Scenario: Don't Save discards and proceeds
  Given the unsaved-changes prompt is showing
  When the user chooses Don't Save
  Then the edits are discarded and the original action proceeds

Scenario: Cancel keeps everything as it was
  Given the unsaved-changes prompt is showing
  When the user chooses Cancel
  Then the project stays open with its edits intact

Scenario: Unsaved edits are visible
  Given a project has unsaved edits
  Then the editor shows that the project has unsaved edits
  And that indicator clears after a successful save

Scenario: Closing the app window with unsaved edits asks first
  Given a project has unsaved edits
  When the user closes the app window
  Then the window stays open and the same Save / Don't Save / Cancel prompt is shown
  And choosing Don't Save (or Save, once it succeeds) then closes the window

Scenario: A save that doesn't happen abandons the action
  Given the unsaved-changes prompt is showing
  When the user chooses Save but the save is canceled or fails
  Then the original action does not proceed
  And the project stays open with its edits intact

Scenario: Opening a project from the recent list is guarded the same way
  Given a project has unsaved edits
  When another project is opened by any route
  Then the same prompt is shown first
```

## Notes
- Closing the window needs the Electron main process to hold the close
  event until the renderer answers; that's the only part that isn't
  purely UI.
- Out of scope: autosave and crash recovery.

**Implemented.** Decisions on the open question and the details:
- **How "unsaved" is computed:** by reference. `hasUnsavedChanges(state)`
  in `editor-store.tsx` is `state.sceneRoot !== state.project.scene`.
  Every edit builds a new tree, and only opening, creating or saving puts
  the saved tree back, so nothing has to remember to set a flag. The known
  cost is a false positive: an edit reverted by hand still reads as
  unsaved (as does a no-op edit that rebuilds the tree). Undo/redo
  (`scene-designer/TASK.undo-redo-for-scene-edits.md`) can refine this.
- **One prompt, one guard.** `guardUnsavedChanges` in the store runs an
  action immediately if nothing is unsaved, otherwise parks it and shows
  `UnsavedChangesDialog` (`role="alertdialog"`, Escape = Cancel, Save is
  focused). `closeProject` and `openProject(filePath?)` both go through
  it, as does the window close; a recent-list open uses `openProject`, so
  it's covered too.
- **The prompt comes before the native open dialog**, not after a file is
  picked. That's simpler to reason about, and it keeps an open that was
  abandoned at the prompt from being recorded as a recent project. The
  cost: choosing Don't Save and then cancelling the file dialog leaves the
  project open with its edits (nothing is lost, since nothing is replaced
  until an open succeeds).
- **A save that doesn't happen cancels the action:** `saveProject` and
  `saveProjectAs` now resolve `true` only when the file was written.
- **Window close:** the renderer pushes its unsaved state to the main
  process (`app.setUnsavedChanges`); `main/unsaved-changes-guard.ts` holds
  the window's `close` event while it's set and tells the renderer
  (`app.onCloseRequested`), which shows the same prompt and, once the user
  has decided, calls `app.confirmClose`.
- **Visibility:** the status bar shows "● Unsaved changes", and the window
  title gets a "● " prefix and the project name.
- **Verified** against the real app (see `startup-view/EPIC.startup-view.md`):
  no prompt when clean; prompt on Close and on Open; Cancel, Escape, Don't
  Save and Save-then-proceed each behave as specified; the indicator
  appears on edit and clears on save; and a real `BrowserWindow.close()`
  with unsaved edits stays open and prompts, Cancel keeps the window, and
  Don't Save quits the app without writing. Not covered by any check: the
  "Save was canceled or failed" branch, and opening from the recent list
  while dirty (the list is only reachable from the startup view today,
  where nothing can be dirty; it becomes reachable with
  `STORY.open-recent-in-project-menu.md`).
