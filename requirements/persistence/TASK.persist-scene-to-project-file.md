---
status: done
component: persistence
related: [EPIC.project-persistence.md, TASK.define-project-snapshot-interfaces.md, TASK.generate-json-schema-from-interfaces.md, scene-designer/EPIC.scene-designer.md, scene-designer/STORY.scene-menu-node-crud.md, scene-designer/TASK.lock-workspace-to-project-mode.md, file-browser, startup-view/EPIC.startup-view.md, project-list/EPIC.project-list.md]
---

# Task: Wire Save/Save As/Open to real project files

## Context
Every "save" action in the app today (Save Scene, Save Scene As,
Close Scene) only appends a message to the Output log — nothing is
written to disk, and nothing can be reopened after the app restarts.
`FileSystemPanel` also only shows a hardcoded fake file list, since
there's no real project on disk to read.

**This task assumes the format already exists.** It used to also own
"define the file format," which is why its acceptance criteria were
too vague to build against — "a scene file is written to disk"
doesn't say what's in it. That design work is now
`TASK.define-project-snapshot-interfaces.md` (the `ProjectSnapshot`
shape) and `TASK.generate-json-schema-from-interfaces.md` (the JSON
Schema that validates it); this task is purely the wiring on top of
those.

Both of those, plus a full SOLID persistence-layer abstraction, are
now built as `@goodstuff/persistence`
(`ProjectFileReader`/`Writer`/`Lister`, `ProjectSerializer`,
`ProjectSnapshotValidator`, and a `FileSystemProjectRepository` façade
composing them — see that package's source for the actual interfaces).
This task is now **ready to start**: it's pure IPC/UI wiring, calling
`FileSystemProjectRepository` (constructed with `NodeProjectFileReader`/
`NodeProjectFileWriter`/`NodeProjectFileLister`) from the Electron main
process, with no remaining design work underneath it.

## Description
Implement, through the Electron main process (not the renderer
directly, per the existing main/preload/renderer separation):
- **Save Scene** — serializes the current `ProjectSnapshot` to JSON and
  writes it to the project's established file location.
- **Save Scene As...** — prompts for a file location, then behaves as
  Save Scene to that new location for subsequent saves.
- **Open** — reads a project file from disk, validates it against the
  JSON Schema from `TASK.generate-json-schema-from-interfaces.md`, and
  loads it into the editor (mode, metadata, and scene tree all
  restored).
- **FileSystem dock** — `FileSystemPanel` reflects the real files
  present for the open project instead of its current hardcoded list.

## Acceptance Criteria
```gherkin
Scenario: Saving writes a real, schema-valid project file
  Given a project with a scene tree and a committed mode
  When the user chooses "Save Scene" (with a project location established)
  Then a JSON file conforming to the ProjectSnapshot schema is written to disk
  And the Output log confirms the save with the file path

Scenario: Reopening a saved project restores it exactly
  Given a previously saved project file
  When it is opened
  Then the scene tree matches what was saved (same nodes, kinds, transforms, names)
  And the project's mode matches what was saved

Scenario: Save Scene As prompts for a new location
  When the user chooses "Save Scene As..."
  Then the user is asked to choose a file location
  And subsequent "Save Scene" actions save to that new location

Scenario: Opening an invalid project file fails clearly
  Given a project file that fails JSON Schema validation
  When the user attempts to open it
  Then the open is refused with a clear error
  And no partial/corrupt project is loaded into the editor

Scenario: FileSystem dock reflects the real project
  Given a project has been saved to disk
  Then the FileSystem dock lists the actual files present, not a hardcoded placeholder list
```

## Notes
- Out of scope: multi-scene tabs, a project picker/launch screen
  (`project-list`/`startup-view` components) — this task is about a
  single project round-tripping to disk, not the full project
  lifecycle UI.
- Schema validation on open (not just on save) is required scope here
  — see the "invalid project file" scenario above. Don't treat
  validation as optional hardening; it's the mechanism that makes the
  "reject corrupt/incompatible files" behavior real instead of aspirational.

**Implemented.**
- `apps/desktop/src/main/project-ipc.ts` composes a `FileSystemProjectRepository`
  (Node-backed reader/writer/serializer/validator from
  `@goodstuff/persistence`) and registers `ipcMain.handle` for
  `project:save`, `project:save-as`, `project:open`, and
  `project:list-directory`. Errors are caught and returned as plain,
  serializable `{ outcome, message, issues? }` results rather than
  thrown — exceptions lose their prototype chain across the IPC
  boundary, so `instanceof` checks against `@goodstuff/persistence`'s
  error types only happen main-process-side, before the boundary.
- `apps/desktop/src/preload/index.ts` exposes `window.goodstuff.project.{save,saveAs,open,listDirectory}`,
  typed against a new shared `GoodStuffWindowApi` contract in
  `@goodstuff/core` (`project-ipc-contract.ts`) so the preload
  implementation, the renderer's `env.d.ts` global, and `@goodstuff/ui`'s
  own global declaration can't drift apart.
- `packages/ui/src/editor/state/editor-store.tsx` gained `project`/`projectFilePath`
  state and `saveProject`/`saveProjectAs`/`openProject`/`closeProject`
  actions. `SceneMenu` wires these to their menu items and gained a new
  **"Open Project..."** entry (there was previously no way to trigger
  Open at all). `FileSystemPanel` now calls `listDirectory` against the
  open project's folder instead of showing a hardcoded list, with
  explicit no-project/loading/error states.
- Project mode: since `scene-designer/TASK.lock-workspace-to-project-mode.md`
  and the real New Project flow aren't built yet, a brand-new
  (never-saved) project currently defaults to `mode: "2D"` when first
  saved. This is a deliberate, temporary stand-in — once
  `startup-view/STORY.new-project-flow-with-mode-commitment.md` is
  wired up, project creation should supply a real chosen mode instead
  of this default.
- **Verification limits**: the underlying save→load round-trip,
  missing-file, and schema-rejection behavior were proven by a manual
  smoke test against both real disk and an in-memory substitute (see
  `EPIC.project-persistence.md`). Typecheck and production build are
  clean and the app launches without error. What was **not**
  click-tested by the agent: the native OS save/open file dialogs
  themselves — that requires manual GUI interaction. Please verify
  Save/Save As/Open/Close end-to-end in the running app before
  considering this fully verified.
