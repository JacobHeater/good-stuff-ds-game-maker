---
status: done
component: project-list
related: [EPIC.project-list.md, SPIKE.recent-projects-storage.md, TASK.recent-projects-store.md, startup-view/STORY.open-existing-project-flow.md, startup-view/STORY.startup-landing-screen.md, project-menu/STORY.open-recent-in-project-menu.md]
---

# Story: Recent projects list on the startup view

## Context
Delivers the missing first scenario of
`startup-view/STORY.open-existing-project-flow.md`: choosing "Open
Existing Project" shows a list of projects instead of jumping straight
to the native file dialog. The data comes from
`TASK.recent-projects-store.md`; the storage and behavior decisions are
in `SPIKE.recent-projects-storage.md`.

## Description
"Open Existing Project" opens a panel (like New Project's) listing recent
projects, most recent first. Each row shows the project's name, its mode
(2D or 3D — informational only; there's no way to change it), its file
path, and when it was last opened. Clicking a row opens that project,
locked to its stored mode, with no mode question. A "Browse..." action
opens the native dialog for a project that isn't listed. Each row has a
remove action (removes it from the list, never deletes the file), and
there's a "Clear list" action. A row whose file no longer exists is shown
disabled and marked missing, and can only be removed. An empty list shows
an empty-state message and Browse. A failed open (invalid project file)
is shown in the panel.

## Acceptance Criteria
```gherkin
Scenario: Open Existing Project shows the recent list
  Given projects have been opened or saved before
  When the user chooses "Open Existing Project"
  Then a list of recent projects is shown, most recent first
  And each row shows name, mode, path and last-opened time

Scenario: Choosing a row opens the project in its own mode
  Given a recent 3D project
  When its row is chosen
  Then the editor opens with only the 3D viewport tab
  And the user is never asked to choose a mode

Scenario: No mode-changing option is offered
  Then no row or action offers to open a project as the other mode

Scenario: Browse opens the native dialog
  When "Browse..." is chosen and a valid project file is picked
  Then that project opens and is added to the recent list

Scenario: Empty state
  Given no projects have been recorded
  When "Open Existing Project" is chosen
  Then an empty-state message and the Browse action are shown

Scenario: A missing file is disabled
  Given a recent project whose file no longer exists
  Then its row is shown disabled and marked missing
  And it can be removed from the list

Scenario: Removing a row never deletes the file
  When a row's remove action is used
  Then the entry leaves the list and the project file on disk is untouched

Scenario: Clear list empties the list
  When "Clear list" is chosen
  Then the list is empty

Scenario: An invalid project file is reported in the panel
  Given a recent entry whose file fails schema validation
  When its row is chosen
  Then the open is refused with the error shown in the panel
  And no project is loaded
```

## Notes
- Out of scope: search, pinning, thumbnails.

**Implemented** as `OpenProjectPanel`
(`packages/ui/src/startup/OpenProjectPanel.tsx`), shown by `StartupView`
when "Open Existing Project" is chosen (that button no longer opens the
native dialog itself; "Browse..." does). Each row is a button that opens
the project by path (`openProject(filePath)`), plus a separate remove
button (✕); a missing row's open button is disabled and it carries a
"missing" badge. "Clear list" only shows when there's something to
clear. The native dialog isn't touched until Browse. An invalid file's
error is shown in the panel, and a failed open records nothing. Looking
at the list never creates the recents file.
`startup-view/STORY.open-existing-project-flow.md` and the startup epic
moved to `done` with this.
