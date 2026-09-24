---
status: done
component: project-menu
related: [EPIC.project-menu.md, persistence/TASK.persist-scene-to-project-file.md, startup-view/STORY.open-existing-project-flow.md, scene-designer/STORY.scene-menu-node-crud.md]
---

# Story: Project menu — open, save, save as, close

## Context
Before this story the "Project" button in the menu bar did nothing, and
the four project-file actions were in the Scene menu under scene-flavored
names (see `EPIC.project-menu.md` for the ownership rule and why they
moved). `ProjectMenu` (`packages/ui/src/editor/layout/ProjectMenu.tsx`)
is the dropdown that now owns them; it shares its dropdown behavior with
`SceneMenu` through `menu-primitives.tsx`. The actions themselves are
the editor store's `openProject`/`saveProject`/`saveProjectAs`/
`closeProject`, which go through the persistence layer
(`persistence/TASK.persist-scene-to-project-file.md`) — this story only
concerns where they're reachable from and what they're called.

## Description
A "Project" dropdown (click to open, click outside to close) offering,
in this order:
- **Open Project...** — opens a project file through the native open
  dialog, replacing the open project. Same action as the startup view's
  "Open Existing Project".
- **Save Project** — writes the project to its file (asking for a
  location the first time, if it has none).
- **Save Project As...** — asks for a new location and writes there;
  later saves go to that location.
- **Close Project** — closes the project and returns to the startup view.

Save and Save As never change the project's mode. There is no "New
Project" entry here; see `EPIC.project-menu.md`.

## Acceptance Criteria
```gherkin
Scenario: The Project menu offers the project-file actions
  Given a project is open
  When the Project menu is opened
  Then it offers "Open Project...", "Save Project", "Save Project As..." and "Close Project"

Scenario: Save Project writes the project to disk
  Given an open project
  When "Save Project" is chosen from the Project menu
  Then the project file on disk contains the current scene
  And the project's mode is unchanged

Scenario: Save Project As writes to a new location
  Given an open project
  When "Save Project As..." is chosen and a location is picked
  Then the project is written to that location
  And later "Save Project" actions write to that location

Scenario: Open Project replaces the open project
  Given a project is open
  When "Open Project..." is chosen and a valid project file is picked
  Then that project is loaded, locked to its own stored mode

Scenario: Close Project returns to the startup view
  Given an open project
  When "Close Project" is chosen
  Then no project is open and the startup view is shown

Scenario: Project-file actions are not in the Scene menu
  When the Scene menu is opened
  Then it offers no Open, Save, Save As or Close entry
  And no action appears in both the Project menu and the Scene menu
```

## Notes
- Choosing "Open Project..." and cancelling the dialog leaves the open
  project untouched. A failed open (invalid file) is reported in the
  Output log and also leaves the open project untouched.
- Open Project and Close Project ask Save / Don't Save / Cancel first
  when the project has unsaved edits (`STORY.unsaved-changes-guard.md`).
  Choosing "Open Project..." runs that guard *before* the file dialog.
- The Project menu is only visible while a project is open, because the
  menu bar is part of the editor shell and the startup view replaces
  the shell. That's why "New Project" isn't in it yet.
