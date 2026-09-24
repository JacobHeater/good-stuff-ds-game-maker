---
status: done
component: persistence
related: [EPIC.project-persistence.md, TASK.define-project-snapshot-interfaces.md, TASK.generate-json-schema-from-interfaces.md, scene-designer/EPIC.scene-designer.md, scene-designer/STORY.scene-menu-node-crud.md, scene-designer/TASK.lock-workspace-to-project-mode.md, file-browser, startup-view/EPIC.startup-view.md, project-list/EPIC.project-list.md]
---

# Task: Wire Save/Save As/Open to real project files

## Context
Every "save" action in the app at the time this was written (then
called Save Scene, Save Scene As, Close Scene; now Save Project, Save
Project As, Close Project in the Project menu — see
`project-menu/EPIC.project-menu.md`) only appended a message to the Output log — nothing is
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
- **Save Project** — serializes the current `ProjectSnapshot` to JSON and
  writes it to the project's established file location.
- **Save Project As...** — prompts for a file location, then behaves as
  Save Project to that new location for subsequent saves.
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
  When the user chooses "Save Project" (with a project location established)
  Then a JSON file conforming to the ProjectSnapshot schema is written to disk
  And the Output log confirms the save with the file path

Scenario: Reopening a saved project restores it exactly
  Given a previously saved project file
  When it is opened
  Then the scene tree matches what was saved (same nodes, kinds, transforms, names)
  And the project's mode matches what was saved

Scenario: Save Project As prompts for a new location
  When the user chooses "Save Project As..."
  Then the user is asked to choose a file location
  And subsequent "Save Project" actions save to that new location

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
  actions. They were first wired into `SceneMenu` (which is also where
  "Open Project..." first appeared, since there was previously no way to
  trigger Open at all); they've since moved to `ProjectMenu`
  (`project-menu/STORY.project-lifecycle-actions.md`). `FileSystemPanel` now calls `listDirectory` against the
  open project's folder instead of showing a hardcoded list, with
  explicit no-project/loading/error states.
- Project mode: this originally defaulted a never-saved project to
  `mode: "2D"` as a temporary stand-in. **That default is gone.** Every
  project is now created through the New Project flow with an explicit
  mode (`startup-view/STORY.new-project-flow-with-mode-commitment.md`),
  so Save never invents one; `saveProject` just refreshes the open
  project's scene and keeps its mode.
- Later additions on the same IPC surface: `project.open(filePath?)` opens
  a known file without a dialog (used by the recent-projects list), and
  the main process records every successful open and save-as into the
  recent-projects store (`project-list/TASK.recent-projects-store.md`);
  `saveProject`/`saveProjectAs` in the store now resolve `true` only when
  the file was written, which the unsaved-changes guard relies on
  (`project-menu/STORY.unsaved-changes-guard.md`).
- Save/Save As/Close now require an open project; with none open (the
  startup view) they do nothing. "Close Project" returns to the startup
  view.
- **Verification limits**: the underlying save→load round-trip,
  missing-file, and schema-rejection behavior were proven by a manual
  smoke test against both real disk and an in-memory substitute (see
  `EPIC.project-persistence.md`). Typecheck and production build are
  clean and the app launches without error. What was **not**
  click-tested by the agent: the native OS save/open file dialogs
  themselves — that requires manual GUI interaction. Please verify
  Save/Save As/Open/Close end-to-end in the running app before
  considering this fully verified.
