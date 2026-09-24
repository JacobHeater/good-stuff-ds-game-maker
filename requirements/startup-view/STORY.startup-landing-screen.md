---
status: done
component: startup-view
related: [EPIC.startup-view.md, STORY.new-project-flow-with-mode-commitment.md, STORY.open-existing-project-flow.md, persistence/EPIC.project-persistence.md]
---

# Story: Startup landing screen

## Context
The app used to have no concept of "no project is open" — it booted
straight into `EditorShell` with an in-memory sample scene. This story
introduced the neutral landing screen that appears instead, before any
project is open, matching Godot's Project Manager as the app's true
entry point.

## Description
Show a landing screen with app branding and exactly two entry points:
"New Project" and "Open Existing Project." This screen has no other
responsibilities — it doesn't itself collect a project name, mode, or
show a list of projects; it only routes into the two flows owned by
`STORY.new-project-flow-with-mode-commitment.md` and
`STORY.open-existing-project-flow.md`. It is shown whenever no project is
open, which includes after "Close Project".

Implemented as `StartupView`
(`packages/ui/src/startup/StartupView.tsx`), rendered by `EditorShell`
when `state.project` is null.

## Acceptance Criteria
```gherkin
Scenario: Landing screen appears when no project is open
  Given the app is launched with no project currently open
  Then a landing screen is shown instead of the Scene Designer
  And it shows the app's name/branding

Scenario: Landing screen offers exactly two entry points
  Given the landing screen is shown
  Then a "New Project" action and an "Open Existing Project" action are both visible
  And no other project-management actions are shown on this screen

Scenario: Choosing New Project proceeds to the mode-commitment flow
  When the user chooses "New Project"
  Then the new-project flow begins (see
    STORY.new-project-flow-with-mode-commitment.md)

Scenario: Choosing Open Existing Project starts the open flow
  When the user chooses "Open Existing Project"
  Then the open-existing-project flow begins (see
    STORY.open-existing-project-flow.md)
```

## Notes
- No in-memory sample project sits behind this screen any more.
  `createSampleSceneTree()` is still exported from
  `packages/core/src/scene-node.ts` as demo data but nothing in the app
  uses it.
