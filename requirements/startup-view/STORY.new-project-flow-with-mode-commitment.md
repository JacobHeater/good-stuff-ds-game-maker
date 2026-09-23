---
status: proposed
component: startup-view
related: [EPIC.startup-view.md, STORY.startup-landing-screen.md, persistence/EPIC.project-persistence.md, scene-designer/TASK.lock-workspace-to-project-mode.md]
---

# Story: New Project flow with mandatory, permanent mode commitment

## Context
Real DS games commit to a rendering pipeline — 2D or 3D — as a
fundamental, upfront decision; the DS's 2D and 3D engines are separate
hardware units, and a real game doesn't casually mix "which engine
this project targets" the way the current scaffold's sample scene
does (it populates both 2D and 3D nodes in one tree purely for
demo purposes). This story makes that same commitment happen in the
editor, at the moment a project is created, and makes it stick.

This is the central requirement of the Startup view: **a new project
must declare itself 2D or 3D before it exists, and can never change
that declaration afterward.** Converting an existing project from one
mode to the other is explicitly not supported — a user who wants the
other mode is expected to start a new project from scratch.

## Description
When the user chooses "New Project" from the landing screen, collect
whatever a new project needs (at minimum: a name/location) **and a
required mode selection: "2D" or "3D."** The project cannot be created
without an explicit mode choice — there is no default. Once created,
the chosen mode is written into the project's persisted data (see
`persistence/EPIC.project-persistence.md` for the on-disk
format this depends on) as a permanent, immutable attribute of that
project. The newly created project opens directly into the Scene
Designer, already locked to its committed mode (see
`scene-designer/TASK.lock-workspace-to-project-mode.md`).

## Acceptance Criteria
```gherkin
Scenario: Mode selection is required to create a project
  Given the New Project flow is open
  When the user attempts to create the project without selecting a mode
  Then project creation is blocked
  And the user is prompted to choose "2D" or "3D" before proceeding

Scenario: Creating a 2D project commits it to 2D permanently
  Given the user selects "2D" as the mode and provides a project name
  When the project is created
  Then the project's stored mode is "2D"
  And the new project opens into the Scene Designer with only the "2D"
    viewport tab available (no "3D" tab)

Scenario: Creating a 3D project commits it to 3D permanently
  Given the user selects "3D" as the mode and provides a project name
  When the project is created
  Then the project's stored mode is "3D"
  And the new project opens into the Scene Designer with only the "3D"
    viewport tab available (no "2D" tab)

Scenario: A project's mode cannot be changed after creation
  Given a project was created with mode "2D"
  Then no control anywhere in the editor allows changing that project's
    mode to "3D"
  And converting to the other mode requires creating an entirely new project

Scenario: A newly created project starts with a mode-appropriate blank scene
  Given a project was just created with mode "3D"
  Then its initial scene contains only 3D-appropriate starter content
    (or an empty 3D-compatible root), not 2D nodes
```

## Notes
- This supersedes part of the currently-Done
  `scene-designer/STORY.workspace-tabs-and-screen-filter.md`, which
  documents today's free 2D/3D tab switching as intended behavior. It
  isn't wrong for what exists today (there's no project-mode concept
  yet), but once this story and
  `scene-designer/TASK.lock-workspace-to-project-mode.md` ship, that
  story's tab-switching scenarios need to be revisited to reflect that
  only one of 2D/3D is ever available per project.
- Out of scope here: what exactly "project location" means (local
  folder picker, project name validation, etc.) — that's ordinary
  new-project chrome and isn't specific to the mode-commitment rule
  this story exists to define. Flesh that out as a follow-up if it
  turns out to need its own ticket.
- `createSampleSceneTree()` (`packages/core/src/scene-node.ts`), which
  currently mixes 2D and 3D content in one demo tree, is exactly the
  kind of thing this rule prohibits for real projects — it should
  remain only as internal scaffold/demo data, not a model for what a
  real created project looks like.
