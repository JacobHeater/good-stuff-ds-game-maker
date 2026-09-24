---
status: done
component: project-list
related: [EPIC.project-list.md, TASK.recent-projects-store.md, STORY.recent-projects-list-on-startup-view.md, project-menu/STORY.open-recent-in-project-menu.md, startup-view/STORY.open-existing-project-flow.md, persistence/EPIC.project-persistence.md]
---

# Spike: Where do recent projects live?

## Context
`startup-view/STORY.open-existing-project-flow.md` can't be finished
without a list of projects to open, and the list needs somewhere
app-level to remember them. Nothing in the app is app-level today: a
project is a single file the user chose the location of, and there's no
app settings file, no projects folder, and no registry. Godot's Project
Manager solves this with a per-user config file listing the projects it
has seen; the question here is what the equivalent is for an Electron app
whose persistence layer is already SOLID-segregated JSON-with-a-schema.

## Description
Decide where the recent-projects list is stored, what it records, when it
is recorded, and how it fits the existing persistence design — well
enough that the Task and Stories can be built without further design.

### Options considered

**A. A JSON file owned by the Electron main process, in the per-user
app-data directory** (`app.getPath("userData")`). *Chosen.*
- Survives restarts, is per OS user, and is the same in dev and in a
  packaged build.
- The main process is already where every project file operation
  happens, so it's the one place that sees every open and save.
- It can check whether a listed file still exists; the renderer can't.

**B. Renderer `localStorage`.** Rejected. Its storage is keyed by web
origin, and the dev build is served from a `localhost` URL while the
packaged build loads from a `file://` URL, so the two would silently keep
separate lists. It's also invisible to the main process (which needs it
for recording, existence checks, and any future native menu) and can't be
validated against a schema, which every other persisted thing here is.

**C. The operating system's recent-documents list**
(`app.addRecentDocument`). Rejected as the source of truth. Electron
lets an app add entries and clear the list but gives no way to read it
back, so it can't drive our own list, and on Windows it only surfaces
for registered file types. It could still be called *as well*, purely as
an OS-shell nicety (jump list), later — nothing here rules it out.

**D. Scan a default projects folder.** Rejected. Projects are saved
wherever the user chooses (New Project opens a Save As dialog); there's
no designated folder to scan, and inventing one would change the New
Project flow for the sake of a list.

**E. Store it inside project files.** Rejected. A project can't know
about other projects, and this is per-user state, not project content.

### Decisions

1. **Storage.** `recent-projects.json` in `app.getPath("userData")`,
   written and read by the main process only.
2. **Format.** JSON, like the project file, with `formatVersion: 1`, and
   validated by a JSON Schema on read (same convention as
   `persistence/EPIC.project-persistence.md`). A file that is missing,
   unreadable, or fails validation is treated as an **empty list** — it
   must never block startup or show an error to the user — and is simply
   replaced on the next write.
3. **Entry shape.** `{ path, name, mode, lastOpenedAt }`, where
   `lastOpenedAt` is an ISO 8601 timestamp. `name` and `mode` are
   **copied into the entry when it's recorded**, so listing doesn't have
   to open and parse every project file. That's safe: `mode` is permanent
   for the life of a project by design, and there is no rename feature
   (if one is ever added, it re-records the entry). The `RecentProjectEntry`
   type lives in `@goodstuff/core` because it crosses the IPC boundary.
4. **What records an entry.** Every successful **Open**, every successful
   **Save As** (which is also how New Project writes its first file),
   recorded by the main process at the same choke point as the file
   operation, so the startup view and the Project menu record identically
   and the renderer never has to remember to. A plain **Save** to the
   existing path doesn't record: saving isn't opening. The renderer is
   **not** given a "record" operation at all.
5. **Ordering, identity, size.** Most recently opened first. Two paths
   are the same project if they resolve to the same absolute path
   (case-insensitively on Windows); re-recording moves the entry to the
   top rather than duplicating it. The list is capped at **10**, oldest
   dropped. (Godot has no cap; 10 is a UI-sized default, easy to change.)
6. **Missing files.** Existence is checked **when the list is read**, not
   stored. A missing entry is still returned, flagged `missing`, so the UI
   can show it disabled instead of it vanishing. It is **not** auto-pruned
   (a project on an unplugged drive or unmounted share is temporarily
   missing, not gone); the user removes it explicitly. Trying to open a
   missing entry does not attempt the open.
7. **Where the code lives.** In `@goodstuff/persistence`, under
   `recents/`, reusing its JSON/ajv/Node-file building blocks, but as its
   **own segregated ports** rather than additions to the project-file
   ones: `RecentProjectsReader` (`list`) and `RecentProjectsWriter`
   (`record`, `remove`, `clear`). A consumer that only displays the list
   depends on the reader alone; the renderer gets list/remove/clear over
   IPC and nothing else. The only Electron-specific piece is supplying the
   `userData` path from `apps/desktop/src/main`. An in-memory
   implementation sits beside the JSON-file one for tests, the same way
   the project store has one.
8. **UI.** The startup view's "Open Existing Project" always shows the
   list, with a "Browse..." action that opens the native dialog (an empty
   list shows an empty-state message plus Browse). The Project menu gets
   an inline "Open Recent" section. Both read the one list.

### Explicitly not decided / out of scope
Pinned projects, search or filtering, thumbnails, sorting other than most
recent, syncing across machines, and the `app.addRecentDocument` OS
integration.

## Acceptance Criteria
```gherkin
Scenario: The spike produces a decision
  Given the options for storing recent projects
  Then a chosen storage location and the reasons the others were rejected are written down
  And what an entry records, what records it, and its ordering, size and missing-file rules are decided

Scenario: The decision is buildable
  Then the follow-on Task and Stories exist with acceptance criteria that reflect these decisions
```

## Notes
- Follow-on tickets: `TASK.recent-projects-store.md`,
  `STORY.recent-projects-list-on-startup-view.md`,
  `project-menu/STORY.open-recent-in-project-menu.md`.
- Outcome for `startup-view/STORY.open-existing-project-flow.md`: that
  story's first scenario ("shows the project list") is delivered by
  `STORY.recent-projects-list-on-startup-view.md`.
