---
status: in-progress
component: testing
related: [TASK.e2e-tests-for-editor-flows.md, TASK.persistence-contract-tests.md, TASK.compiler-and-rom-regression-tests.md, persistence/EPIC.project-persistence.md, startup-view/EPIC.startup-view.md, project-menu/EPIC.project-menu.md, compiler/EPIC.compile-and-export-nds-rom.md]
---

# Epic: Automated testing

## Context
The repo has no test framework and no committed test. Everything built so
far was verified by throwaway scripts run once, by hand, at the end of the
work. Two of those scripts were good enough to keep and now live in
`tests/prototypes/` (see its README): an end-to-end script that drives the
real built Electron app (28 checks) and a smoke test for the
recent-projects store (16 checks). They pass today, but nothing runs them:
not `pnpm test`, not CI, and not before a commit, so the only thing
protecting the behavior they cover is someone remembering to re-run them.

**Update:** a runner now exists and 96 fast tests run under `pnpm test`, plus 9
emulator tests under `pnpm test:rom` (compiler and shared geometry; see
`TASK.compiler-and-rom-regression-tests.md`). The persistence, editor-flow and CI
parts of this Epic are still to do.

## Narrative
Behavior in this project is specified as Gherkin acceptance criteria in
`requirements/`, and a `done` ticket is only as trustworthy as whatever
checked it. This Epic turns the one-off checks into a suite that runs the
same way every time, so a `done` ticket stays done.

It deliberately builds on what exists rather than starting over: the
prototype scripts encode real knowledge (how to drive Electron over CDP
with only the OS dialogs stubbed, how to isolate the app's user-data
directory, which `innerText` quirks bite) that shouldn't be re-derived.

Two layers, because they answer different questions:
- **Contract tests** (fast, no Electron) for the pure and port-based code:
  `@goodstuff/core`, `@goodstuff/persistence`, and, when it exists, the
  compiler's scene-to-DS translation. `TASK.persistence-contract-tests.md`.
- **End-to-end tests** (slow, real app) for the flows a user actually
  performs. `TASK.e2e-tests-for-editor-flows.md`.

A third layer arrives with the compiler: a ROM built from a known project
should boot in an emulator and look the way it should
(`TASK.compiler-and-rom-regression-tests.md`).

## Acceptance Criteria (narrative)
The Epic is done when one command runs the contract and end-to-end suites
from a clean checkout on Windows; every Gherkin scenario in a `done`
ticket for persistence, the startup view, the project menu, and the recent
projects list has a test that fails if the behavior breaks; the suite runs
in CI on every pull request; and the prototype scripts in
`tests/prototypes/` have either been absorbed into the suite or deleted
with a note saying where their coverage went.
