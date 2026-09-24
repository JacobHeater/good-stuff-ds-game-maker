---
status: proposed
component: testing
related: [EPIC.automated-testing.md, TASK.e2e-tests-for-editor-flows.md, persistence/EPIC.project-persistence.md, persistence/TASK.persist-scene-to-project-file.md, project-list/TASK.recent-projects-store.md]
---

# Task: Contract tests for core and persistence

## Context
The persistence layer was designed around Interface Segregation and Liskov
Substitution: every port has more than one implementation (Node and
in-memory file access; JSON-file and in-memory recent projects), and the
promise is that they are interchangeable, including in how they fail. That
promise is only worth something if a test enforces it. Today it's enforced
by two run-once scripts: an earlier persistence smoke test that was deleted
after use, and `tests/prototypes/recents-smoke.ts` (16 checks), which is
kept and does run one behavior suite against every recent-projects
implementation.

No test runner exists in the repo. `@goodstuff/core` (the scene tree
operations, budget calculation, mode rules) has no tests at all.

## Description
Add `vitest` and write committed tests for the packages that have no
dependency on Electron or React:
- **Port contract suites**: one shared suite per port, run against every
  implementation, so a new implementation only has to be added to a list to
  be held to the same behavior. `ProjectFileReader`/`Writer`/`Lister`
  (Node vs. in-memory, including that both throw the *same error types* for
  missing files), `RecentProjectsReader`/`Writer` (in-memory vs. JSON over
  memory vs. JSON over disk).
- **Project file round trip**: `ProjectSnapshot` through the serializer and
  validator and back, and rejection of files that fail the schema, including
  one with no `mode`.
- **`@goodstuff/core`**: scene tree insert / remove / duplicate / unique
  naming, `getNodeKindsForMode` and `isNodeKindAllowedInMode`,
  `computeSceneBudget`.
- **Editor store reducer**: the mode-lock guards (`SET_WORKSPACE`,
  `SET_SCREEN_FILTER`, `ADD_NODE`) and `hasUnsavedChanges`. The reducer is
  pure, so this needs no DOM.
- **A drift check for the hand-authored JSON Schemas**: generate a valid
  `ProjectSnapshot` and recent-projects file from the TypeScript types'
  factories and assert the schemas accept them, so adding a field to a type
  without updating its schema fails a test. (This is an interim guard until
  `persistence/TASK.generate-json-schema-from-interfaces.md` removes the
  hand-authored schema.)

`tests/prototypes/recents-smoke.ts` is the starting point for the recent-
projects suite; port its cases rather than re-inventing them.

## Acceptance Criteria
```gherkin
Scenario: One command runs the contract tests
  Given a clean checkout with dependencies installed
  When the documented test command is run from the repo root
  Then the contract tests run without launching Electron
  And the command exits non-zero if any fails

Scenario: A new port implementation is held to the same contract
  Given a port with a shared contract suite
  When an implementation is added to that suite's list
  Then it is run against every behavior the existing implementations are

Scenario: Substitutable implementations fail identically
  Given the Node-backed and in-memory file implementations
  When a missing file is read
  Then both throw ProjectFileNotFoundError, not a provider-specific error

Scenario: The recent-projects rules are enforced
  Then tests cover ordering, moving a re-recorded project to the top,
    the cap of 10, case-insensitive identity on Windows only, missing-file
    flagging without pruning, remove and clear, overlapping writes, and a
    missing / non-JSON / wrong-shape / wrong-version store reading as empty

Scenario: Schema and types can't silently drift
  When a field is added to ProjectSnapshot or RecentProjectEntry without
    updating its JSON Schema
  Then a test fails

Scenario: Mode lock is protected at the reducer
  Then tests assert a 2D project rejects 3D nodes and a workspace switch to
    the other mode, and a 3D project never gets the "both screens" filter
```

## Notes
- **The runner now exists.** `vitest` 2 is installed at the repo root and `pnpm test`
  runs the core and compiler tests (see `TASK.compiler-and-rom-regression-tests.md`).
  vitest 5 doesn't work with the repo's pinned Vite 5. What's left for this task is
  the persistence, recent-projects and reducer suites themselves; the shared-suite
  pattern is proven by `tests/prototypes/recents-smoke.ts`.
- `hasUnsavedChanges` compares scene-tree identity, so its test should
  build state via the reducer, not by hand-constructing trees, or it can
  pass without proving the reducer preserves identity on load and save.
- Keep the prototype script until each of its checks has a home here, then
  note that in this ticket (same rule as the end-to-end task).
