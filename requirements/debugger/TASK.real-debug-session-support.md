---
status: proposed
component: debugger
related: [STORY.debugger-tab-placeholder.md, run-games-locally]
---

# Task: Real debug session support

## Context
The Debugger tab is currently a static placeholder (see
`STORY.debugger-tab-placeholder.md`) because there is no game runtime
to debug — Play is a stub. Once `run-games-locally` produces an actual
running game (in whatever form that takes — embedded runtime,
emulator, etc.), the Debugger tab should show real, live information
about that running session.

## Description
Define and implement live debugging information once a real game
runtime exists: at minimum, a running/stopped state, and some form of
inspectable state (variables, current scene, frame timing). Exact
scope depends heavily on what `run-games-locally` ends up building the
runtime on top of — this task is intentionally light on specifics
until that's decided.

## Acceptance Criteria
```gherkin
Scenario: The Debugger tab reflects an active session
  Given a game is running (started via Play)
  When the "Debugger" tab is active
  Then it shows that a session is active, replacing the "no session" placeholder

Scenario: The Debugger tab returns to the placeholder when the session ends
  Given a game was running and is then stopped
  Then the Debugger tab returns to the "no active session" placeholder
```

## Notes
- Blocked on `run-games-locally` establishing what "running a game"
  actually means in this app before this can be scoped further.
