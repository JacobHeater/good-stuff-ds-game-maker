---
status: done
component: file-browser
related: [STORY.static-filesystem-dock-stub.md, persistence/EPIC.project-persistence.md]
---

# Story: FileSystem dock lists the project's folder

## Context
Replaces the hardcoded placeholder list described in
`STORY.static-filesystem-dock-stub.md` now that project files exist on
disk. `FileSystemPanel`
(`packages/ui/src/editor/panels/FileSystemPanel.tsx`) asks the main
process, through `window.goodstuff.project.listDirectory`, to list the
directory containing the open project's file. Listing is read-only and
goes through `ProjectFileLister`, the segregated read/list port in
`@goodstuff/persistence`.

## Description
Show the files that sit next to the open project's file, by name (the
full path is the tooltip). While loading, on failure, and when the
folder has nothing else in it, the dock says so instead of showing a
stale or fake list.

## Acceptance Criteria
```gherkin
Scenario: The dock lists the real files in the project's folder
  Given a project saved at some folder
  Then the FileSystem dock lists the files in that folder by file name
  And no hardcoded placeholder paths are shown

Scenario: The listing follows the open project
  Given the FileSystem dock is showing one project's folder
  When a different project is opened or the project is saved elsewhere
  Then the dock lists the new project's folder

Scenario: A listing failure is shown, not hidden
  Given the project's folder can't be listed
  Then the dock shows the error message instead of a file list
```

## Notes
- Out of scope, still: sub-folders, opening a file from the dock,
  drag-and-drop into the scene, and a `res://`-style project-relative
  path scheme. Files only, flat, read-only.
- The listing is fetched when the project's file path changes, not
  watched, so a file added on disk while the app is open won't appear
  until the next save or open.
