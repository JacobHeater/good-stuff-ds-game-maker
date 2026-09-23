---
status: proposed
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
```

## Notes
- Blocked on `project-list` having a real list to show, which is
  itself blocked on `persistence/EPIC.project-persistence.md`.
- If a project's persisted data is somehow missing a mode (e.g. a
  corrupted or hand-edited project file), decide the failure behavior
  when this is implemented — treat as invalid and refuse to open,
  don't silently default to a mode. Not written as a Gherkin scenario
  here since it depends on error-handling decisions the persistence
  Task hasn't made yet.
