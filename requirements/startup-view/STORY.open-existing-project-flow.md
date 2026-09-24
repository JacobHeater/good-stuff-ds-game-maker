---
status: done
component: startup-view
related: [EPIC.startup-view.md, STORY.startup-landing-screen.md, project-list/EPIC.project-list.md, scene-designer/TASK.lock-workspace-to-project-mode.md]
---

# Story: Open Existing Project flow

## Context
The other half of the Startup view's landing screen: opening a
project that was already created (and therefore already has a
permanently committed 2D-or-3D mode — see
`STORY.new-project-flow-with-mode-commitment.md`). The actual list of
existing projects to pick from belongs to `project-list`; this story
only covers the handoff into that list and what happens once a
project is chosen.

## Description
When the user chooses "Open Existing Project" from the landing screen,
show the existing-projects list (`project-list`'s concern) and, once
one is chosen, open it directly into the Scene Designer — configured
for whatever mode that project already committed to at creation. No
step in this flow asks the user to choose or confirm a mode; the
project's stored mode is simply read and applied.

## Acceptance Criteria
```gherkin
Scenario: Choosing Open Existing Project shows the project list
  When the user chooses "Open Existing Project" from the landing screen
  Then the list of existing projects is shown

Scenario: Opening a project applies its already-committed mode
  Given an existing project was created with mode "3D"
  When the user opens that project
  Then the Scene Designer opens with only the "3D" viewport tab
    available
  And the user is never asked to choose a mode during this flow

Scenario: No mode-switching option is offered while opening a project
  Given a project's stored mode is "2D"
  Then nothing in the Open Existing Project flow offers to open it as
    "3D" instead

Scenario: A project file with no mode is refused
  Given a project file that is missing its mode
  When the user tries to open it
  Then the open is refused with a clear error shown on the startup view
  And no project is loaded and no mode is defaulted
```

## Notes
**Implemented.** "Open Existing Project" shows the recent-projects list
(`project-list/STORY.recent-projects-list-on-startup-view.md`, backed by
`project-list/TASK.recent-projects-store.md`; the storage decision is
`project-list/SPIKE.recent-projects-storage.md`), with a "Browse..."
action for a project that isn't listed. Choosing a row or browsing loads
the file through the persistence layer and opens it locked to its stored
mode; no step asks for or offers a mode. A file that fails schema
validation, including one with no `mode` (which the schema requires), is
refused with the error shown in the list panel and nothing loaded or
recorded. The Output log isn't visible on the startup view, so
`openProject` returns the failure to the caller instead.

The same open action is also reachable from the Project menu's "Open
Project..." (`project-menu/STORY.project-lifecycle-actions.md`).
