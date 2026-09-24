---
status: done
component: debugger
related: [STORY.hardware-budget-report.md, STORY.debugger-tab-placeholder.md]
---

# Story: Output log tab

## Context
Godot's bottom panel has an "Output" tab that streams editor/engine
log messages. The equivalent here is the `Output` tab of `BottomPanel`
(`packages/ui/src/editor/panels/BottomPanel.tsx`), fed by the shared
editor store's `outputLog` array and `log(message)` action — used
today by the Project menu's Save/Open/Close/Export ROM actions (Export
reports each compiler diagnostic and the outcome here), the Play button
stub, and the Scene menu's Add/Delete/Duplicate Node confirmations.

## Description
Show every logged message, in order, in a scrollable monospace list.
The log starts with a startup message and a "loaded sample scene"
message when the editor first opens.

## Acceptance Criteria
```gherkin
Scenario: The Output tab shows logged messages in order
  Given the editor has logged "Good Stuff DS Game Maker ready." then
    "Added Sprite2D node \"Sprite2D\"."
  When the "Output" tab is active
  Then both messages are visible, in that order

Scenario: New log messages appear without needing a manual refresh
  Given the Output tab is visible
  When a new action logs a message (e.g. deleting a node)
  Then that message appears in the Output tab immediately
```

## Notes
- The log is in-memory only and resets on app restart — this is
  acceptable for now since it's a live session log, not a persisted
  audit trail.
