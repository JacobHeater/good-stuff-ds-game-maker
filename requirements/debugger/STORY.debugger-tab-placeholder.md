---
status: done
component: debugger
related: [STORY.output-log-tab.md, TASK.real-debug-session-support.md]
---

# Story: Debugger tab placeholder

## Context
Godot's Debugger tab shows live state (stack, variables, breakpoints)
while a game is running. No game runtime exists yet in this project
(the Play button is a stub — see
`run-games-locally/STORY.play-button-stub.md`), so the Debugger tab in
`BottomPanel` is intentionally a static placeholder for now, not a
broken feature.

## Description
Show a fixed placeholder message in the Debugger tab explaining that
no debug session is active, since Play doesn't yet start a real
session.

## Acceptance Criteria
```gherkin
Scenario: Debugger tab shows a static "no session" message
  Given the "Debugger" tab is active
  Then the message "No active session. Press Play to start a debug
    session once a runtime is wired up." is shown
  And no live debugging state (stack, variables, breakpoints) is shown
```

## Notes
- Real debugging functionality is out of scope for this story by
  design — see `TASK.real-debug-session-support.md`, which is blocked
  on a real game runtime existing (`run-games-locally`).
