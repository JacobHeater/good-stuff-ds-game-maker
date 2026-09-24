---
status: done
component: file-browser
related: []
---

# Story: Static FileSystem dock stub

## Context
Godot's editor has a "FileSystem" dock listing every resource in the
open project (`res://...`). The Good Stuff DS Game Maker scaffold
needed the same visual slot in the left dock before any real project
file I/O existed, so a stand-in was built: `FileSystemPanel`
(`packages/ui/src/editor/panels/FileSystemPanel.tsx`) renders a
hardcoded list of fake `res://` paths. There is no component folder
that owned this piece of the UI, even though it's implemented and
visible in every session — this ticket closes that documentation gap.

## Description
Render a FileSystem dock in the left sidebar, below the Scene Tree,
showing project resource paths in `res://...` form, matching Godot's
visual convention. No real filesystem access, project format, or
click/open behavior exists yet — this is a static, read-only visual
placeholder only.

## Acceptance Criteria
```gherkin
Scenario: FileSystem dock renders under the Scene Tree
  Given the editor is open
  Then a "FileSystem" panel is visible in the left dock, below the Scene Tree panel

Scenario: FileSystem dock lists placeholder project resources
  Given the FileSystem dock is visible
  Then it lists a fixed set of "res://" paths (e.g. "res://project.gsds", "res://scenes/main.scene")
  And no file on disk is actually read to produce this list
```

## Notes
- **Superseded.** The dock no longer shows a hardcoded list; this story
  records what the scaffold did originally and its acceptance criteria
  above no longer describe current behavior. See
  `STORY.filesystem-dock-lists-project-folder.md`.
- Real functionality (actually listing a project's files, opening them,
  drag-and-drop into the scene, etc.) is out of scope for this ticket
  and belongs in a future Story/Task once project file I/O exists (see
  `persistence/EPIC.project-persistence.md`, which is the
  prerequisite: there's no real project on disk to browse until scenes
  can be saved).
