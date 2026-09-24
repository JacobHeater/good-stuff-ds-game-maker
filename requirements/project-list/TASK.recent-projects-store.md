---
status: done
component: project-list
related: [SPIKE.recent-projects-storage.md, EPIC.project-list.md, persistence/EPIC.project-persistence.md, STORY.recent-projects-list-on-startup-view.md, project-menu/STORY.open-recent-in-project-menu.md]
---

# Task: Recent-projects store

## Context
The decisions are in `SPIKE.recent-projects-storage.md`; this Task is
building them, with no design left open. It's the data and IPC side only
— the two Stories that show the list depend on it.

## Description
Implement, following the segregation already used for project files:
- In `@goodstuff/core`: `RecentProjectEntry` (`path`, `name`, `mode`,
  `lastOpenedAt`) and the list result type used across IPC, where each
  listed entry additionally carries `missing: boolean`; and extend
  `GoodStuffWindowApi` with `recents.{list,remove,clear}` (no `record`).
- In `@goodstuff/persistence`, `recents/`: ports `RecentProjectsReader`
  (`list`) and `RecentProjectsWriter` (`record`, `remove`, `clear`); a
  JSON-file implementation using a hand-authored (interim, like the
  project schema) JSON Schema with `formatVersion: 1`; an in-memory
  implementation.
- In `apps/desktop/src/main`: compose the JSON-file store at
  `app.getPath("userData")/recent-projects.json`; record on every
  successful open and save-as in the existing project IPC handlers;
  register `recents:list|remove|clear` handlers; expose them in preload.

## Acceptance Criteria
```gherkin
Scenario: Opening a project records it
  When a project is opened successfully
  Then it is at the top of the recent list with its name, mode and a lastOpenedAt time

Scenario: Save As records the new location, plain Save does not
  When "Save As" succeeds to a new path
  Then that path is recorded
  When a plain "Save" succeeds to the existing path
  Then the recent list is unchanged

Scenario: Re-recording a project moves it to the top without duplicating it
  Given a project already in the list
  When it is recorded again, even spelled with different letter case on Windows
  Then it appears once, at the top

Scenario: The list is capped
  Given 10 recent projects
  When an 11th is recorded
  Then the list has 10 entries and the oldest was dropped

Scenario: Missing files are flagged, not dropped
  Given a recorded project whose file no longer exists
  When the list is read
  Then the entry is still returned, marked missing

Scenario: A missing or corrupt store is an empty list
  Given the recent-projects file is absent, unreadable, or fails schema validation
  When the list is read
  Then it is empty and no error is raised

Scenario: Remove and Clear
  When an entry is removed
  Then only that entry is gone
  When the list is cleared
  Then it is empty

Scenario: The renderer cannot record
  Then the window API exposes list, remove and clear for recents, and no record operation

Scenario: Reader and writer are independently substitutable
  Then a consumer needing only the list depends on RecentProjectsReader alone
  And an in-memory implementation can stand in for the JSON-file one with identical observable behavior
```

## Notes
- Failed opens and failed saves record nothing.
- Validation failures on the store's own file are swallowed (empty
  list), unlike project files, where they're reported to the user.

**Implemented.**
- `@goodstuff/core` (`recent-projects.ts`): `RecentProjectEntry`,
  `RecentProjectListing` (entry + `missing`), `MAX_RECENT_PROJECTS = 10`;
  `GoodStuffWindowApi` gained `recents.{list,remove,clear}` — `remove` and
  `clear` resolve to the *updated* list so the UI needn't re-fetch — and
  no `record`. `project.open` now takes an optional `filePath` (open a
  known file without a dialog) rather than a second `openPath` method.
- `@goodstuff/persistence`: ports `RecentProjectsReader` (`list`),
  `RecentProjectsWriter` (`record`, `remove`, `clear`) and a tiny
  `PathExistenceChecker` (`exists` only; `ProjectFileReader` satisfies it
  structurally, but the list needn't be able to read files).
  `JsonFileRecentProjectsStore` implements both list ports on top of the
  existing `ProjectFileReader`/`ProjectFileWriter` ports, so pointing it
  at `InMemoryProjectFileStore` gives a store with no disk at all;
  `InMemoryRecentProjects` is the direct in-memory substitute. The
  ordering/dedupe/cap/missing-flag rules live once, in
  `recents/recent-projects-list.ts`, so the two can't drift. Path
  identity is `path.resolve`, lower-cased on Windows only
  (`createPathKey`). Operations on the JSON store run one at a time
  through a promise queue, so overlapping calls can't lose entries or read
  a half-written file. The schema (`RECENT_PROJECTS_JSON_SCHEMA`) is
  hand-authored, like the project one.
- `apps/desktop`: `main/recent-projects-ipc.ts` composes the store at
  `app.getPath("userData")/recent-projects.json` (Electron's
  `--user-data-dir` redirects it) and registers `recents:list|remove|clear`;
  `recordRecentProject` is best-effort (a failure is logged, never shown).
  `project-ipc.ts` takes only the *writer* port and records on every
  successful open and on save-as (including a plain Save that had to ask
  for a location); a Save to the known path doesn't record.
- **Verified:** 16 store checks against the in-memory, JSON-over-in-memory-
  files and JSON-over-real-disk implementations (the same suite run
  against each: order, dedupe, cap at 10, remove/clear, overlapping
  writes, case-insensitive vs -sensitive identity, missing flags, and
  absent/non-JSON/wrong-shape/wrong-version/empty stores reading as empty
  and healing on write), plus the end-to-end run of the real app described
  in `startup-view/EPIC.startup-view.md`. Both were throwaway scripts —
  there's still no committed test framework.
