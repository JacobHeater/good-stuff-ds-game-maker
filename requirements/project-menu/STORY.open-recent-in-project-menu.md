---
status: proposed
component: project-menu
related: [EPIC.project-menu.md, STORY.project-lifecycle-actions.md, project-list/SPIKE.recent-projects-storage.md, project-list/TASK.recent-projects-store.md, project-list/STORY.recent-projects-list-on-startup-view.md]
---

# Story: Open Recent in the Project menu

## Context
Once recent projects are stored
(`project-list/TASK.recent-projects-store.md`), the Project menu is the
second place, after the startup view, where a user expects to reopen one
— Godot and most editors put "Open Recent" under File. It reads the same
list the startup view does; it does not keep its own.

## Description
Add an "Open Recent" section to the Project menu, between "Open
Project..." and "Save Project", listing the recent projects (most recent
first, at most 10, as stored) by project name with the 2D/3D mode shown.
Choosing one opens it, replacing the open project. The currently open
project is not listed as an option to open. An entry whose file no
longer exists is shown disabled and marked as missing rather than hidden.
The section has a "Clear Recent" entry. With nothing recent, the section
shows a disabled "No recent projects" line.

It's an inline section, not a fly-out submenu: the shared
`MenuDropdown` has no submenu support and ten entries fit.

## Acceptance Criteria
```gherkin
Scenario: Recent projects are listed in the Project menu
  Given projects have been opened or saved before
  When the Project menu is opened
  Then an "Open Recent" section lists them, most recent first, by name and mode

Scenario: Choosing a recent project opens it
  When a recent project is chosen
  Then it is loaded, locked to its own stored mode
  And it moves to the top of the recent list

Scenario: The open project is not offered as a recent entry to open
  Given a project is open
  Then it does not appear as an openable "Open Recent" entry

Scenario: A missing file is shown, not hidden
  Given a recent project's file has been moved or deleted
  Then its entry is shown disabled and marked as missing

Scenario: Empty state
  Given no projects have been recorded
  Then the section shows a disabled "No recent projects" line

Scenario: Clear Recent empties the list
  When "Clear Recent" is chosen
  Then the recent list is empty everywhere it is shown, including the startup view
```

## Notes
- Everything this depends on now exists: the store and its
  `window.goodstuff.recents.list/clear` (`project-list/TASK.recent-projects-store.md`),
  `openProject(filePath)` in the editor store, and the unsaved-changes
  prompt (`STORY.unsaved-changes-guard.md`) — choosing a recent project
  goes through `openProject`, so it's guarded automatically. What's left
  is only this menu section. Read the list when the menu opens (it's
  cheap and a file may have gone missing since the last look), and hide
  the currently open project's entry rather than showing it disabled.
- Unlike the startup view's list, this menu has no per-entry remove
  action; "Clear Recent" is the only pruning here.
