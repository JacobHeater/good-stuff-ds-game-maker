---
status: proposed
component: testing
related: [EPIC.automated-testing.md, TASK.persistence-contract-tests.md, startup-view/EPIC.startup-view.md, project-menu/EPIC.project-menu.md, project-menu/STORY.unsaved-changes-guard.md, project-list/STORY.recent-projects-list-on-startup-view.md, persistence/TASK.persist-scene-to-project-file.md]
---

# Task: End-to-end tests for the editor flows

## Context
`tests/prototypes/e2e/e2e.mjs` already drives the real built Electron app
end to end and passes 28 checks. It is a single 400-line script with
inline assertions, hard-wired ports, a hand-rolled `pass()` logger, one
long shared session where later checks depend on state left by earlier
ones, and its own `package.json` outside the workspace. It's a proof that
the approach works, not something to build a suite on. **The script is
kept as it is** until this task replaces it (see the last scenario); it is
not to be deleted just because a new suite exists.

Two more prototypes, `tests/prototypes/e2e/export-rom.mjs` (8 checks) and
`tests/prototypes/e2e/play.mjs` (6 checks, opens real melonDS windows), cover "Export ROM..." and
the toolbar's Play the same way (both need the DS toolchain; Play also needs melonDS) and are kept
for the same reason.

The technique it proved, which the suite should keep:
- Launch `apps/desktop` with `--remote-debugging-port` and `--inspect`,
  drive the renderer with `puppeteer-core`, and stub **only** the native
  file dialogs by evaluating in the main-process inspector
  (`Runtime.evaluate` with `includeCommandLineAPI: true` to get
  `require("electron")`). Real IPC, real persistence layer, real files.
- Give Electron a temp `--user-data-dir` so recent projects are the app's
  own and never the developer's.

## Description
Turn the prototype into a committed suite under a real test runner:
- Pick the runner (Playwright's Electron support is the obvious candidate
  and would replace the hand-rolled CDP plumbing; `vitest` plus
  `puppeteer-core` is the smaller step from what exists). Decide and record
  it here.
- Each test starts a fresh app with a fresh user-data directory and its own
  temp project files, so tests don't depend on each other's leftovers and
  can run in any order.
- One test file per ticket-sized area, named for it, so a failing test
  points straight at the ticket it protects: startup landing, new project
  and mode commitment, mode lock, Scene vs. Project menus, save / save as /
  open / close, recent projects, unsaved-changes guard.
- Shared helpers (launch app, stub dialogs, click a labeled button, project
  fixtures) live in one place instead of at the top of a script.
- Runs from the repo root with one command, builds the app first if needed,
  picks free ports, and always kills the app it started.

## Acceptance Criteria
```gherkin
Scenario: One command runs the end-to-end suite
  Given a clean checkout with dependencies installed
  When the documented end-to-end command is run from the repo root
  Then the app is built if needed, launched, exercised and shut down
  And the command exits non-zero if any test fails

Scenario: Tests are independent
  Given any single end-to-end test
  When it is run alone, or after any other test, in any order
  Then it passes
  And it never reads or writes the developer's real recent-projects list

Scenario: Every done scenario in the covered tickets is protected
  Given the Gherkin scenarios in the done tickets for the startup view, new
    project, mode lock, project menu, unsaved-changes guard, and recent
    projects list
  Then each has an end-to-end test that fails if that behavior regresses
  And the test's name or a comment cites the ticket

Scenario: Only native OS dialogs are faked
  Then no test stubs the renderer, IPC, persistence layer, or file system
  And the stubbed dialogs are the only difference from a real session

Scenario: A failure leaves evidence
  When an end-to-end test fails
  Then a screenshot of the renderer at the point of failure is saved

Scenario: The prototype is retired deliberately
  Given the suite covers everything the prototype's 28 checks covered
  Then a note in this ticket records where each check went
  And only then is tests/prototypes/e2e removed
```

## Notes
- Not covered by anything automated, and not coverable this way: the real
  native OS save / open dialogs. A person needs to click through them.
- The prototype's port numbers (9333, 9229) are fixed; the suite must pick
  free ones or parallel runs and a stray dev instance will collide.
- Windows-first: that's the only platform the app has been run on.
- Known false-positive risk to keep in mind while asserting: unsaved-change
  detection is by scene-tree identity, so a hand-reverted edit still reads
  as unsaved (see `project-menu/STORY.unsaved-changes-guard.md`). Tests
  should not assert the opposite.
