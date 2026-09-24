---
status: proposed
component: scene-designer
related: [EPIC.scene-designer.md, STORY.workspace-tabs-and-screen-filter.md, persistence/TASK.define-project-snapshot-interfaces.md, persistence/TASK.generate-json-schema-from-interfaces.md, compiler/TASK.ds-scene-intermediate-representation.md]
---

# Task: Save the FPS target in the project

## Context
The toolbar has a 30 / 60 FPS switch, held in the editor's session state
(`fpsTarget` in the editor store, default 60). It isn't part of
`ProjectSnapshot`, so it isn't saved: reopening a project resets it to 60,
and anything that works from a saved project file, such as the compiler run
from a terminal, can't know what the author chose. The compiler takes the
frame rate as an option (`translateScene3D(project, { fpsTarget })`, default
60) as a stopgap.

The frame rate is a property of the game, not of the editing session: a 30 FPS
game is designed and budgeted differently from a 60 FPS one.

## Description
Add the FPS target to the project format, set it from the existing toolbar
control, restore it when a project is opened, and have the compiler read it
from the project instead of taking it as an option.

Because it changes `ProjectSnapshot`, this is a format change: the hand-authored
JSON Schema must be updated in the same change, projects saved before it must
still open (defaulting to 60), and the format version policy in
`persistence/EPIC.project-persistence.md` applies.

## Acceptance Criteria
```gherkin
Scenario: The FPS target is saved with the project
  Given a project whose FPS target is set to 30
  When it is saved and reopened
  Then the target is still 30

Scenario: Older project files still open
  Given a project saved before the FPS target existed
  When it is opened
  Then it loads with a target of 60
  And it is not rejected by schema validation

Scenario: Changing the target marks the project as having unsaved changes
  When the FPS target is switched
  Then the project shows unsaved changes

Scenario: The compiler uses the project's target
  Given a project with a 30 FPS target
  When it is compiled without any frame-rate option
  Then the scene data has a 30 FPS presentation rate

Scenario: The schema and the type agree
  Then the JSON Schema accepts a project with a target of 30 or 60 and rejects any other value
```

## Notes
- Switching the target currently doesn't touch the project, so it also
  doesn't count as an unsaved change (`hasUnsavedChanges` compares scene trees).
  Storing it in the project means deciding how that comparison should treat a
  setting outside the scene.
- The compiler tests use the option today; keep it as an override.
