# Good Stuff DS Game Maker — Project Context

## What this is
A Nintendo DS–flavored video game maker: an Electron + React desktop app
modeled on the Godot editor's UX, for building *actual DS games* — not
modern games. Every system constraint (frame rate, polygon budget, sprite
counts, VRAM, etc.) is meant to reflect real DS hardware limits, surfaced in
the editor the way Godot surfaces target-platform limits.

## Repo layout (pnpm workspace monorepo)
- `apps/desktop` — the Electron shell (main, preload, renderer composition
  root). Intentionally thin: wires up the main process and renders `<App />`
  from `@goodstuff/ui`.
- `packages/core` (`@goodstuff/core`) — domain models: scene node tree, DS
  hardware profile, hardware budget math. No UI/Electron deps.
- `packages/ui` (`@goodstuff/ui`) — shared React components; the actual
  designer UI lives here.
- `packages/build-config` (`@goodstuff/build-config`) — shared electron-vite
  build configuration.
- `packages/persistence` (`@goodstuff/persistence`) — SOLID project
  persistence layer (serialization, validation, file I/O). No UI/Electron
  deps; consumed by `apps/desktop`'s main process (see below).
- `packages/compiler` (`@goodstuff/compiler`) — compiles a saved 3D project into
  a Nintendo DS ROM: pure translation to DS-format scene data, diagnostics, a
  build driver that runs the devkitPro toolchain, a CLI, and the hand-written C
  runtime under `runtime/`. Depends only on core. See the `compiler` entry below.
- `tools/ds-toolchain/` — Windows scripts to install and use devkitPro and melonDS.
- `tests/prototypes/` — the kept, hand-rolled verification scripts (editor E2E incl. the sound player measured on real audio,
  recent-projects store, a UI-authored-scene generator). Not in the workspace.
- Root: `pnpm test` (fast tests), `pnpm test:rom` (emulator tests), `vitest*.config.ts`.

## Stack decisions
- **Electron + Vite, not Next.js.** Next.js was considered (to "simplify
  React conventions") but rejected: this is an Electron desktop app, and
  Next.js doesn't drop cleanly into an Electron renderer without static
  export mode, which throws away most of what Next offers. Vite + React
  stays.
- **Tailwind v4**, not plain CSS. This was already corrected once before
  (prompt history: an earlier plain-CSS attempt was explicitly rejected as
  "hardly modern"). Tailwind v4 is wired via `@tailwindcss/vite`, with a
  dark, Godot-editor-inspired theme (`--color-editor-*` tokens) in
  `apps/desktop/src/renderer/src/styles.css`.
- **React 18**, not 19. `@react-three/fiber`/`@react-three/drei` are pinned
  to the v8/v9 majors (not v9/v10, which require React 19) to match.

## Editor UI (Godot-inspired dock layout)
`EditorShell` (`packages/ui/src/editor/EditorShell.tsx`) lays out: MenuBar,
WorkspaceToolbar (workspace tabs + screen filter + FPS target + Play),
SceneTreePanel + FileSystemPanel (left dock), a center viewport + BottomPanel
(Output/Debugger/Hardware tabs), and InspectorPanel (right dock).

- **Startup view** (`packages/ui/src/startup/`): with no project open
  (`state.project === null`, including after Close Project) `EditorShell`
  renders `StartupView` instead of the editor: exactly "New Project" and
  "Open Existing Project". New Project (`NewProjectPanel`) requires a
  name and an explicit 2D/3D choice (nothing preselected), then opens the
  native Save As dialog for the location. Open Existing Project
  (`OpenProjectPanel`) lists the recent projects — name, mode badge, path,
  last opened, a remove ✕ per row, "Clear list", missing files shown
  flagged and disabled — plus "Browse…" for the native open dialog (which
  is only opened by Browse, never by merely showing the panel). Rows open a
  project by path with no dialog, always in its stored mode.
- **Workspace tabs**: a project shows only its own viewport tab (`2D` for
  a 2D project, `3D` for a 3D project, never both) plus `Script` and
  `Game`. Script is the script editor (see "Scripting" below); Game shows a "not built yet" placeholder (tabs used to
  fall through to the 2D viewport, which would leak into 3D projects).
- **Scene menu vs. Project menu** — a deliberate split, written down in
  `requirements/project-menu/EPIC.project-menu.md`. A menu is named for
  what its actions operate on, and an action lives in exactly one menu.
  The **Scene menu** (`layout/SceneMenu.tsx`) edits the *contents* of the
  open scene: a single "Add {mode} Node" list (2D kinds for a 2D project,
  3D kinds plus `AudioStreamPlayer` for a 3D project — audio isn't drawn
  by either pipeline, so it's offered in both), Import Model (.obj)... (3D
  only) and Import Sound... (both modes), Undo/Redo, Duplicate Node and
  Delete Node (disabled on the scene root). The **Project menu**
  (`layout/ProjectMenu.tsx`) owns the project *file's* lifecycle: Open
  Project..., Save Project, Save Project As..., Export ROM..., Close Project (all real,
  via the persistence layer — see "Save/Save As/Open/Close" below). They
  used to all sit in the Scene menu under names like "Save Scene" /
  "Close Scene" because it was the only real menu; that conflated scene
  and project management and was fixed. **"New Scene" was removed
  outright** (with one scene per project it only meant "discard
  everything", destructive with no undo; it returns if multi-scene is
  ever designed) and so were the store's `NEW_SCENE`/`newScene`. Both
  menus share `layout/menu-primitives.tsx`. The other menu bar items
  (Debug, Editor, Help) are still inert placeholders.
- **Unsaved-changes guard** (`project-menu/STORY.unsaved-changes-guard.md`,
  done). "Unsaved" = `state.sceneRoot !== state.project.scene` (reference
  comparison; `hasUnsavedChanges` in `editor-store.tsx`) — no per-action
  flag, at the cost of a false positive for a hand-reverted edit. One
  `guardUnsavedChanges` in the store wraps `closeProject`,
  `openProject(filePath?)` and the window close; it shows
  `UnsavedChangesDialog` (Save / Don't Save / Cancel; Escape = Cancel).
  The prompt comes *before* the native open dialog. `saveProject` /
  `saveProjectAs` resolve `true` only if a file was written; a Save that
  is canceled or fails abandons the guarded action. The status bar shows
  "● Unsaved changes" and the window title gets a "● " prefix. Window
  close: the renderer pushes its dirty flag to main
  (`app.setUnsavedChanges`); `main/unsaved-changes-guard.ts` holds the
  `close` event while set and asks the renderer, which calls
  `app.confirmClose` once the user decides.
- **2D viewport** (`DualScreenViewport.tsx`): renders the DS's two physical
  screens side by side at a fixed pixel scale, draggable sprite markers.
- **3D viewport** (`Viewport3D.tsx`): the newer addition. Renders whichever
  single screen currently "owns" the 3D engine (the DS can only drive 3D
  output to one screen at a time — screen filter drops "Both" while in 3D
  mode). One canvas, sized to **fill the available panel space** (up to the
  DS's 4:3 aspect ratio, via a `ResizeObserver`-backed `useContainedSize`
  hook — never a small fixed box), but the actual WebGL drawing buffer
  stays locked to the DS's true native 256×192 via a **fractional `dpr`**
  (`DS_WIDTH / displayedWidth`, `gl={{ antialias: false }}`,
  `image-rendering: pixelated`), so it reads as authentically blocky no
  matter how large the working rectangle is on screen. Free `OrbitControls`
  and click-to-select work directly on this one canvas.
  - Meshes are built from the **shared primitive geometry** in
    `@goodstuff/core` (`primitive-geometry.ts`); the scene is drawn as a
    **hierarchy** (`SceneNodeView` recurses; a parent's transform and visibility
    apply to its subtree); a directional light **shines along its node's local
    -Z**, as in Godot and in the compiler. The viewport is still an orbit camera
    with fixed ambient light: `Camera3D` is a gizmo and there's no view through it.
  - History here: v1 rendered the *whole* canvas tiny at a fixed native
    size — rejected as unusable ("how can I build a game there?"). v2 split
    it into a large smooth edit canvas + a separate small pixelated preview
    inset — rejected too (user wants ONE working area, not a separate
    preview). v3 (current) is the fix: single canvas, full available size,
    fixed *internal* resolution via fractional dpr. If resolution work
    comes up again, don't reintroduce a second canvas/preview — the
    fractional-dpr technique is the right one.

## Domain model (`packages/core`)
- `SceneNode` tree, Godot-Node-like, tagged 2D or 3D via `SceneNodeKind`
  (`SceneNodeKind2D` / `SceneNodeKind3D`). 3D nodes carry a `transform3D`
  (position/rotation-degrees/scale as `Vector3`) and, for `MeshInstance3D`,
  a `mesh: { primitive, triangleCount }`. A `CollisionShape3D` carries `collision?: { shape, size, radius, height }` (`collision-shape.ts`,
  see "Collision" below); `audio?` and `scriptId?` are described under "Sound" and "Scripting".
- `primitive-geometry.ts`: the **one definition** of each built-in primitive
  (cube 12 triangles, plane 2, cylinder 48, sphere 168), as a non-indexed
  triangle list with per-vertex normals. The viewport draws it, the budget counts
  from it (never from a node's stored `triangleCount`, which may predate a
  re-tessellation), the compiler emits it. Nothing else carries a per-primitive count.
- Tree helpers: `flattenSceneTree`, `findSceneNode`, `updateSceneNode`,
  `removeSceneNode`, `duplicateSceneNode` (fresh ids throughout),
  `insertNodeAfterSibling`, `uniqueNodeName`, `createSampleSceneTree`
  (demo data mixing 2D and 3D; **nothing in the app uses it any more**).
- `project-mode.ts`: `ProjectMode` (`"2D" | "3D"`), `PROJECT_MODES`,
  `getNodeKindsForMode`, `isNodeKindAllowedInMode`, and
  `createBlankSceneTree(mode)` (root is `Node2D` or `Node3D`). It moved
  here from `scene-node.ts`, which no longer has a blank-tree factory.
- `DS_HARDWARE_PROFILE` (`hardware.ts`): real DS specs — CPU, RAM/VRAM,
  256×192 dual screens, 2D OAM sprite budget (128/screen), 3D budget
  (~2048 triangles/frame, exclusive to one screen at a time), audio
  channels (16), fps targets (30/60).
- `computeSceneBudget` (`budget.ts`): live budget report against the
  profile above — sprite usage per screen, audio channel usage, and now
  triangle usage vs. the 3D budget. Shown in the Hardware tab of
  `BottomPanel`.
- `ProjectSnapshot` (`project-snapshot.ts`): the persisted-project shape
  — `formatVersion`, `id`, `name`, permanent `mode: "2D"|"3D"`,
  `createdAt`/`updatedAt`, and a real `scene: SceneNode` tree embedded
  directly. Replaced the old, entirely unused `GameProject`/`GameScene`/
  `createEmptyProject`/`DS_SCREEN_RESOLUTION` scaffold outright (a
  repo-wide search confirmed zero consumers of any of them) rather than
  keeping two competing "project" concepts side by side. Factories:
  `createProjectSnapshot`, `withUpdatedScene`.

## Persistence layer (`packages/persistence`, new)
A SOLID-designed persistence layer now exists, built specifically with
Interface Segregation and Liskov Substitution as the priorities (an
explicit user requirement — don't casually merge these interfaces back
together for convenience):
- **Segregated ports**, one concern each: `ProjectFileReader`,
  `ProjectFileWriter`, `ProjectFileLister`, `ProjectSerializer`,
  `ProjectSnapshotValidator`. No fat "file system" interface — a
  consumer that only reads never has to depend on write/list methods it
  won't call.
- **Two substitutable implementations** of the file-access ports:
  `NodeProjectFileReader`/`Writer`/`Lister` (real `node:fs/promises`,
  for the Electron main process) and `InMemoryProjectFileStore` (a
  `Map`-backed all-three-in-one, for tests/dev). Both throw the exact
  same error types (`ProjectFileNotFoundError`, `ProjectFileReadError`,
  `ProjectFileWriteError` — see `errors.ts`) for the same failure
  modes, which is what makes them genuine Liskov substitutes rather
  than just same-shaped classes. **Verified**, not just typechecked: a
  manual smoke test ran the identical save/load/error-handling
  assertions against both, real disk and in-memory, and all passed
  identically (no test framework is set up in this repo yet, so this
  was a one-off script, deleted after use — worth setting up `vitest`
  properly if this pattern needs to recur).
- **`JsonProjectSerializer`** (JSON, the chosen wire format) and
  **`JsonSchemaProjectSnapshotValidator`** (ajv-backed, validates
  against `PROJECT_SNAPSHOT_JSON_SCHEMA` — currently **hand-authored**,
  explicitly marked as interim in its own file comment;
  `requirements/persistence/TASK.generate-json-schema-from-interfaces.md`
  still needs to swap this for a schema generated from the TS
  interfaces, which is designed to be a drop-in replacement).
- **`FileSystemProjectRepository`** composes all of the above via
  constructor-injected interfaces (Dependency Inversion) into the
  `ProjectRepository` façade (`save`/`load`).

## Save/Save As/Open/Close — wired end-to-end
`apps/desktop/src/main/project-ipc.ts` composes a `FileSystemProjectRepository`
(Node-backed) and registers `ipcMain.handle` for `project:save`,
`project:save-as`, `project:open`, `project:list-directory` (channel
names shared from `apps/desktop/src/shared/project-ipc-channels.ts` so
main/preload can't drift). Errors are caught and returned as plain
`{ outcome: "ok"|"canceled"|"error", message?, issues? }` results, never
thrown across the IPC boundary — thrown errors lose their prototype
chain there, so `instanceof` checks against `@goodstuff/persistence`'s
error types only happen main-process-side.

`window.goodstuff.project.{save,saveAs,open,listDirectory}` (preload)
is typed against a new shared `GoodStuffWindowApi` contract in
`@goodstuff/core` (`project-ipc-contract.ts`) — the preload
implementation, the desktop app's `env.d.ts` global, and
`packages/ui/src/global.d.ts`'s own global declaration all reference
this one type, so they can't silently diverge.

`editor-store.tsx` gained `project`/`projectFilePath` state and
`saveProject`/`saveProjectAs`/`openProject`/`closeProject` actions.
`ProjectMenu` wires these in (originally they were wired into
`SceneMenu`, since moved — see the menu split above; that's also where
"Open Project..." first appeared, as there was previously no UI path to
Open at all).
`FileSystemPanel` now calls `listDirectory` against the open project's
folder instead of a hardcoded list, with no-project/loading/error
states.

There is no "default mode" any more. The old temporary 2D default is
gone: every project is created through the New Project flow with an
explicit mode, and `saveProject`/`saveProjectAs` only refresh the open
project's scene (they do nothing with no project open). `createProject`
and `openProject` return a `ProjectActionResult` so the startup view —
which has no Output log — can show failures inline.

**Recent projects** (`packages/persistence/src/recents/`, built): ports
`RecentProjectsReader` (`list`) / `RecentProjectsWriter` (`record`,
`remove`, `clear`) plus a tiny `PathExistenceChecker`;
`JsonFileRecentProjectsStore` (built on the existing file reader/writer
ports, so it also runs over `InMemoryProjectFileStore`) and
`InMemoryRecentProjects`, both using the shared rules in
`recent-projects-list.ts`; hand-authored `RECENT_PROJECTS_JSON_SCHEMA`.
Composed in `apps/desktop/src/main/recent-projects-ipc.ts` at
`userData/recent-projects.json`; `project-ipc.ts` receives only the
*writer* and records on every successful open and save-as. The renderer's
`window.goodstuff.recents` has `list`/`remove`/`clear` (the last two return
the updated list) and no `record`. The design decisions are in
`requirements/project-list/SPIKE.recent-projects-storage.md`.

**How this was verified.** Beyond typecheck/build and the persistence
smoke test, the whole startup + mode-lock + save/open flow was driven
against the real built Electron app: launch `electron.exe apps/desktop
--remote-debugging-port=… --inspect=…`, drive the renderer with
`puppeteer-core` over CDP, and stub only `dialog.showSaveDialog` /
`showOpenDialog` from the main-process inspector (via
`Runtime.evaluate` with `includeCommandLineAPI: true` to get
`require("electron")`). Real IPC, real persistence layer, real files.
28 checks pass now (landing/empty Open panel, mode-locked creation, the
two menus' contents, save/save as/close/reopen, recording and
re-recording, open-from-list, invalid file, missing/remove/clear, the
unsaved-changes guard on Close/Open, and a real `BrowserWindow.close()`).
The recent-projects store also has a separate 16-check smoke run against
the in-memory, JSON-over-memory and JSON-over-disk implementations
(bundled with the repo's own `esbuild` via `--alias` to the two packages'
`src/index.ts`, since there's no TS runner). **Both scripts are kept in
the repo, on the owner's instruction, in `tests/prototypes/`** (with a
README giving the exact commands; re-verified from there — 28/28 and
16/16). They're prototypes, not a suite: no test framework exists in the
repo, so none of it runs in CI. Turning them into one is specified in
`requirements/testing/` (`EPIC.automated-testing.md`,
`TASK.e2e-tests-for-editor-flows.md`, `TASK.persistence-contract-tests.md`,
`TASK.compiler-and-rom-regression-tests.md`). Don't delete the prototypes
until those tasks record where each check went.
Gotchas if you redo it: pass `--user-data-dir=<temp>` to Electron so the
recents file is isolated; `innerText` applies CSS `uppercase` (section
labels come back as "ADD 3D NODE"); the toolbar `<select>` adds "Top
Screen" to `innerText`; the Output log persists across projects within a
session; and a click that closes the window (Don't Save on a window
close) races the page target vanishing, so catch that one.

## Known environment gotchas (already fixed — don't re-break these)
- **`apps/desktop` main/preload must stay CommonJS.** An earlier attempt
  used `"type": "module"` + `import.meta.url` so main/preload built as ESM;
  this crashes on launch because Node's ESM/CJS interop chokes on
  Electron's dynamically-patched `electron` module
  (`cjsPreparseModuleExports` / `Cannot read properties of undefined
  (reading 'exports')`). Fixed by removing `"type": "module"` and using
  plain `import { app, BrowserWindow } from "electron"` + native
  `__dirname` in `src/main/index.ts` and `src/preload/index.ts`.
- **`ELECTRON_RUN_AS_NODE=1` leaks into `pnpm dev` from this terminal**
  (this workspace's terminal is hosted inside an Electron app — e.g. VS
  Code — and that env var propagates to spawned children, making
  `electron.exe` run as plain Node instead of a real Electron app).
  `apps/desktop/scripts/dev.mjs` strips it before spawning `electron-vite
  dev`; `apps/desktop/package.json`'s `dev` script calls that wrapper. If
  `pnpm dev` ever mysteriously fails with `electron.app` being undefined,
  check this first.
- **Windows `.bin` shims can go missing** after certain installs (`tsc`
  etc. exist as POSIX shell scripts but no `.CMD`/`.ps1`). Fix: `CI=true
  pnpm install` to force a clean, non-interactive reinstall.
- A stray `@tailwindcss/oxide-linux-x64-gnu` root devDependency (leftover
  from an earlier WSL/Linux dev attempt — `pnpm dev` originally failed on
  WSL over a missing `libnss3.so`) was removed; the project runs on native
  Windows now, not WSL.

## Requirements / ticket tracking (`requirements/`)
A Jira-like ticket system lives in `requirements/`, one folder per
component, with `STORY`/`TASK`/`BUG`/`EPIC`/`SPIKE` markdown tickets
inside. **Every component folder now has at least one ticket** — this
was a deliberate full backfill pass, not partial coverage. Read
`requirements/README.md` for conventions before writing new ones.

**Status convention:** status/component/related live in YAML
frontmatter at the top of each ticket file (`status: proposed |
in-progress | done`), never in the filename, and a ticket is never
moved to a "done" folder. This was an explicit decision: renaming/
moving a file relies on git's rename-detection heuristic and breaks
plain `git log <path>` (no `--follow`); editing status in place with a
stable path has none of that fragility. Don't reintroduce filename- or
folder-based status tracking.

**Process rule:** when shipping functionality that touches a
component, write or update its ticket as part of the same change —
this is a process requirement from the user, not optional
documentation. If shipped functionality has no matching component
folder, create one (`file-browser` was created this way, for the
previously-homeless `FileSystemPanel`).

**Projects permanently commit to 2D or 3D at creation — now implemented.**
This is a deliberate constraint, not a gap: a new project must choose
"2D" or "3D" up front (`startup-view/STORY.new-project-flow-with-mode-commitment.md`),
the choice is stored in the project, and **nothing in the app can ever
change it** — converting means starting a new project. The editor is
locked accordingly (`scene-designer/TASK.lock-workspace-to-project-mode.md`):
a 2D project never shows a "3D" tab and vice versa, the Add Node list
is the mode's own, a 3D project never offers "Both Screens", and the
reducer itself refuses `SET_WORKSPACE` / `SET_SCREEN_FILTER` /
`ADD_NODE` requests that would break the lock (it isn't only hidden UI).
Don't build a feature that assumes a project can hold both 2D and 3D
content, and don't add any control that changes `project.mode`.

**Current coverage** (see each folder for the authoritative, detailed
version — this is a summary, not a substitute):
- `scene-designer` — deepest coverage: an Epic, four retroactive
  Stories (2D viewport, 3D viewport — **read
  `STORY.3d-editing-viewport-native-resolution.md` before touching 3D
  viewport resolution/sizing again**, its three-iteration history is
  recorded there — Scene menu node CRUD (now node-editing only; project
  actions moved to `project-menu`), workspace tabs), the now-done
  mode-lock Task, and forward Task/Spike (undo/redo, asset import). The
  workspace-tabs and scene-menu stories were rewritten to match the
  mode-locked, persistence-backed behavior (they used to document free
  2D/3D switching and stubbed Save/Close). Real
  project persistence used to be scoped here but was refactored out
  into its own `persistence` component (see below) once it became
  clear it's a shared foundation, not a scene-editing feature.
- `persistence` — an Epic (`EPIC.project-persistence.md`, `in-progress`)
  plus three ordered Tasks. See the "Persistence layer" section above
  for what's actually implemented (`@goodstuff/persistence` package,
  `ProjectSnapshot` in core): `TASK.define-project-snapshot-interfaces.md`
  is `done`; `TASK.generate-json-schema-from-interfaces.md` is
  `in-progress` (validator wired and working, schema still
  hand-authored rather than generated); `TASK.persist-scene-to-project-file.md`
  is `done` (Save/Save As/Open/Close wired end-to-end; native dialogs not
  click-tested by the agent). The Epic stays `in-progress` only because
  of the schema-generation task. It unblocks `startup-view`,
  `project-list`, `scene-designer`'s mode-lock and mesh-import Spike,
  and `audio`'s asset Task.
- `node-list`, `properties-panel` — one retroactive Story each (Scene
  Tree panel, Inspector panel), both fully built and Done.
- `debugger` — three retroactive Stories (Output tab, Debugger
  placeholder, Hardware budget report — moved here from
  `scene-designer` since it's the same `BottomPanel` dock) plus a
  forward Task blocked on a real runtime existing.
- `run-games-locally` — the Play-button stub Story, the runtime Spike
  (`done`: the owner decided the first milestone is a compiled ROM run in
  an emulator; in-editor interpreted preview is undecided and deferred),
  the emulator-selection Spike (`done`: melonDS, found via env var / winget / Program Files)
  and `STORY.play-runs-rom-in-emulator.md` (`done`; the stub Story is now superseded).
- `collision` — **first slice built and verified** (all `done`): `EPIC.collision-shapes.md`, `STORY.collision-shapes-and-overlap-checks.md` and four tasks
  (model and persistence, Inspector and viewport, `overlaps()` in the language, compile and run on the DS). See "Collision" below. Also
  `properties-panel/STORY.rename-a-node.md` (`done`): the Inspector's Name field. Nodes could not be renamed before, and scripts name nodes.
- `collision` (continued) — `STORY.solid-shapes-and-move-and-collide.md` (`done`): solid shapes are the ground. `animation` — **first slice built and verified**
  (all `done`): `EPIC.animation-player.md`, `STORY.animation-player-node.md` and four tasks (model and persistence, timeline editor, script control, compile and run).
  See "Solid shapes" and "Animation" below.
- `scripting` — **first slice built and verified** (all `done`): the Spike (decisions below), the Epic, the Story
  `STORY.write-and-run-scripts.md` and tasks `TASK.script-language-front-end.md`, `TASK.script-editor-and-attachment.md`, plus
  `persistence/TASK.embed-scripts-in-project-file.md`, `compiler/TASK.compile-scripts-to-c.md`,
  `compiler/TASK.runtime-node-table-and-script-services.md`. See "Scripting" below.
- `audio` — **built.** `STORY.import-sound-and-audio-player.md` (done) plus `TASK.sound-import-conversion.md`,
  `persistence/TASK.embed-imported-sounds-in-project-file.md`, `compiler/TASK.compile-sounds.md` (all done); the old
  `TASK.audio-asset-playback.md` is done (delivered by those) and `STORY.audio-node-in-hardware-budget.md` is the retroactive
  budget-counting story. See "Sound" below.
- `compiler` — **built for 3D; the first milestone is done and verified.**
  (Owner's instruction: validate the editor by compiling scenes to a real
  `.nds` and running it in an emulator.) A saved 3D project compiles to a real
  ROM that runs in melonDS at 60/60 FPS and draws what the project says.
  Design: shell out to devkitPro (devkitARM + libnds), **detected not
  bundled**, with a **data-driven runtime** — `@goodstuff/compiler`
  (`packages/compiler`, depends only on core) translates the project to a
  constant `scene_data.c` (baked world matrices, DS fixed-point, shared vertex
  tables, camera, lights), and a hand-written checked-in C runtime
  (`packages/compiler/runtime`, no scene logic) draws it. Pipeline: diagnose ->
  translate (`translate-scene-3d.ts`) -> write C (`scene-data-writer.ts`) ->
  `RomBuilder` (`build/`, ports `ToolchainLocator`/`BuildRunner`/`BuildFileSystem`,
  tested with fakes) runs `make` inside MSYS2 -> `.nds`. Use it from a terminal:
  `pnpm --filter @goodstuff/compiler cli:build` then
  `node packages/compiler/dist/cli.mjs compile <project.gsds | fixture:cube|primitives|nested> <out.nds>`
  (about 4 s; exit 3 = toolchain missing). **The app now calls it:** Project >
  "Export ROM..." (`STORY.export-rom-from-project-menu.md`, done) compiles the
  project as the editor has it (unsaved edits included, the file never written),
  checks it first (an error project reports to the Output log without asking for a
  location), writes the `.nds`, and logs diagnostics and the outcome. Code:
  `apps/desktop/src/main/export-rom-ipc.ts` (one export at a time; runtime dir is
  `packages/compiler/runtime` from the repo, `resources/compiler-runtime` when
  packaged via `extraResources` — **packaged path untried**), `describeCompileResult`
  in `packages/compiler/src/compile-report.ts`, `exportRom`/`exporting` in the
  editor store, `ExportRomResult` and `project.exportRom` in core's IPC contract.
  Verified by `tests/prototypes/e2e/export-rom.mjs` (8 checks, needs the toolchain).
  **Play is built too** (`run-games-locally/STORY.play-runs-rom-in-emulator.md`, done):
  the toolbar button builds to `%TEMP%\gsds-play\play-*.nds` and opens melonDS
  (`main/play-ipc.ts`, `PlaySession` in `packages/compiler/src/run/`, ports
  `EmulatorLocator`/`EmulatorLauncher`, `NodeEmulatorLocator` finds it via
  `GSDS_MELONDS_PATH` > winget folder > Program Files). A new run replaces the old one only
  after its build succeeds; the game closes when the editor quits. Both handlers share
  `main/rom-builder-factory.ts`. Verified by `tests/prototypes/e2e/play.mjs` (6 checks;
  kills melonDS.exe before/after). No emulator-path setting UI yet — env var only.
  **Gotcha:** a new Camera3D and mesh both start at the origin, so an untouched
  export shows flat grey (camera inside the cube) — not a compiler bug. Done: Spike, the IR/translation Task, the runtime Task, the build
  driver Task, `STORY.compile-3d-scene-to-nds-rom.md`,
  `STORY.compile-diagnostics-for-unsupported-content.md`, Export ROM. `proposed`: 2D
  (`STORY.compile-2d-scene-to-nds-rom.md`, blocked on image assets).
  **Conventions pinned by building and looking** (full list in the Spike):
  matrices are 16 x f32 (20.12) column-major; rotation is three.js Euler `XYZ`
  (`Rx·Ry·Rz`), node transform `T·R·S`; vertices v16 (4.12, ~±8) with unit-sized
  primitives; lights are parallel only, 4 max, direction = the way the light
  *travels* (local -Z) and set while only the view matrix is loaded; culling off;
  the 3D backdrop is deliberately dark blue (so a screenshot can find the screen).
  **How it's verified** (all real, against melonDS): `pnpm test` — 343 fast tests
  (shared geometry, matrix math checked against three.js itself, fixed point,
  translation, diagnostics, build driver with fakes); `pnpm test:rom` — 9
  emulator tests that build each fixture, run it, capture the top screen and
  compare its silhouette with an independent three.js render (IoU >= 0.85),
  including a project **authored through the real editor UI**
  (`node tests/prototypes/e2e/ui-to-rom.mjs`, then
  `GSDS_ROM_PROJECT=<saved path> pnpm test:rom`; scores 0.91), the bottom
  screen, and a full-budget scene (2028 triangles). Deliberately breaking the
  rotation order fails six tests. **Not verified:** 30 FPS pacing (melonDS's title
  shows emulator speed, not presentation rate). (Lighting was "checked by eye" until it was measured; see the lighting note below,
  which found a real bug.)
  **What compiling turned up in the editor** (all ticketed): three defects,
  now **fixed** — the hardware budget's triangle counts didn't match what the
  viewport drew (sphere 480 vs 720, cylinder 40 vs 64; now one shared geometry in
  `packages/core/src/primitive-geometry.ts`, sphere 168 / cylinder 48, used by the
  viewport, budget and compiler), the viewport ignored a parent's transform and
  visibility (it drew a flat list; now `SceneNodeView` recurses), and a
  directional light's rotation did nothing in the editor (now it shines along its
  local -Z, as in Godot and the compiler). The UI **can now choose a mesh's primitive**
  (Inspector "Mesh" select, `scene-designer/STORY.choose-mesh-primitive.md`, done; "Add
  MeshInstance3D" still adds a cube; `MESH_PRIMITIVES` in core is the one list; verified by
  `tests/prototypes/e2e/mesh-primitive.mjs`, 6 checks, whose saved project also passes the
  emulator test). Still **open**: the FPS target isn't saved in
  the project (`scene-designer/TASK.save-fps-target-in-project.md`, so the compiler
  takes it as an option, default 60); and cameras/lights/meshes have no
  fov/active-camera/colors and the editor never shows the view through a
  `Camera3D` (`scene-designer/STORY.camera-light-and-material-properties.md`).
- **Custom 3D models (`.obj` import) are built** (`scene-designer/STORY.import-obj-model.md`, done; tasks
  `scene-designer/TASK.obj-parser.md`, `persistence/TASK.embed-imported-meshes-in-project-file.md` and
  `compiler/TASK.compile-imported-meshes.md`, all done; the old `SPIKE.custom-mesh-and-sprite-import.md` is
  `done` for meshes, and the sprite half moved to `SPIKE.sprite-image-import.md`, `proposed`). Decisions made with
  the owner: format `.obj`; **embedded in the `.gsds`** (a `meshes` array, `formatVersion` stays 1 because it's
  additive; nothing is copied to an assets folder); **refused at import** if any used vertex is outside about
  ±8 (the DS's `v16` range, `MAX_IMPORTED_COORDINATE`) or the model has more than one frame's triangles (2048),
  with no automatic rescaling; **geometry only, one color per mesh** (mtllib/usemtl/vt are ignored with a
  warning). How it fits: `parseObj` (`packages/core/src/obj-import.ts`, pure) is called by the Electron main
  process (`main/assets-ipc.ts`, `window.goodstuff.assets.importMesh()`) after it reads the file; the renderer
  gets an `ImportedMesh` (indexed vertices + normals + indices) and the `IMPORT_MESH` reducer action adds it to
  `state.project.meshes` and a `MeshInstance3D` (with `mesh.importedMeshId`, no `primitive`) to the scene in one
  step. **Everything gets a mesh's geometry from `resolveMeshGeometry(mesh, project.meshes)`** in
  `packages/core/src/mesh-geometry.ts` (viewport, `computeSceneBudget(root, meshes)`, translator, reference
  render), and shared vertex tables are keyed by `meshSourceKey`. `withUpdatedScene` drops models no mesh uses.
  The persistence validator additionally cross-checks references (a mesh naming a missing model is refused on
  open; `missing-model` is a compile error). UI: **Scene > "Import Model (.obj)..."** (3D projects only) and the
  Inspector's Mesh select lists imported models after the four primitives. Imported meshes are drawn
  double-sided in the viewport because the runtime draws with culling off. Verified by
  `tests/prototypes/e2e/import-obj.mjs` (10 checks) and the emulator (`imported` fixture; a UI-authored
  two-houses-and-a-cube project at IoU 0.941). `tests/prototypes/e2e/models/house.obj` equals `HOUSE_OBJ` in
  `packages/compiler/src/fixtures.ts` (drift-tested). Known limits: shading only checked by eye, no winding
  repair, no rescaling, concave polygons not repaired, a build from before this change rejects a project that
  contains a model.
- **Transform tools** (`scene-designer/STORY.transform-tools-on-toolbar.md`, done): the workspace toolbar (3D
  projects only) has **Select (Q) / Move (W) / Rotate (E) / Scale (R)**; `activeTool` is editor state
  (`EditorTool` in `editor-store.tsx`, not saved, not an edit); keys are handled in `WorkspaceToolbar.tsx` and
  ignored in inputs/selects. In `Viewport3D.tsx`, `SelectionGizmo` wraps drei's `TransformControls` and is
  rendered **at the scene root** (never inside the node's group — that recurses forever); each drawn node
  registers its group in a `Map` (`objects`), and the gizmo finds the selected one each frame. It writes the
  active field back through `setTransform3D` while dragging (rounded to 4 decimals); no gizmo on the scene
  root, a hidden node, or the other screen, and no *scale* gizmo on cameras/lights. Move is world-axis,
  Rotate/Scale local. The canvas ignores "missed" clicks for 400 ms after a gizmo press (`lastGizmoInteractionAt`),
  otherwise releasing a handle deselects the node. Verified with real mouse drags:
  `tests/prototypes/e2e/transform-tools.mjs` (10 checks). Not built: snapping, world/local toggle, multi-select, undo.
- **Undo/redo** (`scene-designer/TASK.undo-redo-for-scene-edits.md`, done): **Ctrl+Z** undoes, **Ctrl+Shift+Z**
  redoes (also Cmd), plus Undo/Redo entries at the top of the Scene menu (they show the edit's label and shortcut).
  `editorReducer` in `editor-store.tsx` wraps the old reducer (now `applyAction`); `edit-history.ts` is the pure
  bookkeeping. A step holds *references* to the scene tree, the project's imported models and the selection (never
  copies), which is why undoing back to the saved tree reads as "no unsaved changes"; saving keeps history,
  opening/creating/closing a project resets it; it's capped at 200 and not saved in the project file. **One step per
  gesture**: edits of the same property of the same node less than 1 s apart merge (sliding window), and a released
  gizmo handle or 2D marker calls `endEditGesture` so two quick drags are two steps. Only the actions in
  `describeEdit` are recorded (add/delete/duplicate, move/rotate/scale, visibility, mesh source, model import); tool,
  screen filter, FPS target, tab and selection alone are not. A no-op edit (same value) is no longer an edit at all.
  The shortcut works with an Inspector field focused, and is ignored on the startup view and behind the
  unsaved-changes prompt. Verified by 27 unit tests and `tests/prototypes/e2e/undo-redo.mjs` (13 checks, real keys
  and drags). Not built: Ctrl+Y, a history panel; Cmd+Z untested.
- **Textures on 3D meshes** (`scene-designer/STORY.mesh-textures.md`, done; tasks `TASK.texture-uv-coordinates.md`,
  `persistence/TASK.embed-imported-textures-in-project-file.md`, `compiler/TASK.compile-textures.md`, all done).
  Decisions made with the owner: **3D mesh textures only** (2D sprites stay in `SPIKE.sprite-image-import.md`);
  **a size the DS can't use is refused**, never resized (each side a power of two from 8 to 1024, and it must fit
  512 KB); **16-bit direct color** (5 bits per channel + 1-bit alpha, 2 bytes a pixel). I chose without asking:
  PNG only, decoded in the main process with **pngjs** (`main/assets-ipc.ts`, `window.goodstuff.assets.importTexture()`);
  **stored embedded and already converted** (`ImportedTexture { id, name, width, height, texels }`, `texels` = base64 of
  little-endian uint16, red in the low 5 bits, opaque flag in bit 15, row 0 on top; `project.textures`, `mesh.textureId`,
  `formatVersion` still 1, one-way for older builds), so the editor shows exactly what the ROM shows; one texture per
  mesh instance; alpha >= 128 is opaque (partly transparent pixels warn). Conversion and every rule live in
  `createTextureFromRgba` (`packages/core/src/imported-texture.ts`, pure). **UVs are in image space** (u right, v DOWN,
  row 0 = v 0; `PrimitiveGeometry.uvs`, `ImportedMesh.uvs`; the OBJ importer reads `vt` and flips v; primitives are
  upright seen from outside — orientation is tested geometrically in `uv-coordinates.test.ts`). Compiler: tables are
  keyed by geometry **and** texture (`primitive:cube|texture:<id>`) because `t16` texture coordinates are in texels and
  depend on the texture's size (`toT16`); a textured mesh is drawn white; errors `missing-texture`, `texture-needs-uvs`,
  `texture-memory`, and out-of-range UVs; runtime (`scene.h`/`main.c`) maps all four VRAM banks as texture memory, uploads
  each texture once (`glTexImage2D` takes the size *class* 0..7), binds one per mesh (`glBindTexture(0, 0)` = none). UI:
  Inspector "Texture" select + "Import PNG..." on meshes (disabled with an explanation when the model has no UVs);
  viewport uses a `DataTexture` (nearest, repeat, sRGB); Hardware tab has a texture-memory bar; texture edits are undoable
  (`textures` is part of `EditState`). Verified by `tests/prototypes/e2e/texture-mesh.mjs` (13 checks) and by the emulator:
  the `textured` fixture is sampled for color at 8 quadrant centers (fails if the picture is wrong). Not built: palettes,
  keeping the original PNG, per-material textures, 2D sprites. Not verified: sampled colors on the sphere/cylinder,
  memory fragmentation near 512 KB.
- **Sound** (`audio/STORY.import-sound-and-audio-player.md`, done). Decisions with the owner: **WAV, MP3 and OGG**; **convert
  automatically** (mix to mono, resample down to at most 32 kHz, never up, store 16-bit; **a sound over the 2 MB budget is resampled
  lower to fit instead of refused**, floor 8 kHz = about 131 s, `MIN_FITTED_SAMPLE_RATE`, with a "will sound duller" warning); **Autoplay off = silent in the ROM** (before
  scripting existed autoplay was the only thing that could start a sound; the compiler still warns `sound-not-started` for an Autoplay-off player no script calls `play()` on). I chose: sounds are
  **embedded in the project** already converted (`ImportedSound { id, name, sampleRate, samples }`, base64 LE int16 mono;
  `project.sounds`, `formatVersion` still 1, one-way for older builds, unused ones dropped on save); `SceneNode.audio?: { soundId?,
  autoplay, volume 0..1, pitch 0.25..4, loop }` on an `AudioStreamPlayer` with **defaults autoplay ON**, volume 1, pitch 1, no loop
  (`getAudioPlayer`); volume is the DS's `round(127 * volume)`, pitch a speed multiplier so the DS plays at `round(sampleRate * pitch)`
  Hz limited to 256..65535 (`playbackFrequency`, warns `sound-pitch-clamped`); all 16 channels play PCM (>16 autoplay players is an
  error `too-many-sounds`); a **2 MB sound budget** (`DS_HARDWARE_PROFILE.audio.soundMemoryBytes`; the samples sit in main RAM as
  `.rodata`). Pipeline: main process only *picks* the file (`assets.pickSound`, returns bytes; `assets-ipc.ts`); the **editor window
  decodes it** (`ui/src/editor/audio/decode-sound.ts`, `OfflineAudioContext.decodeAudioData` at `min(header rate, 32000)`, the header
  rate read by `sniffSoundSampleRate`) and core's pure `createSoundFromPcm` applies every rule (`imported-sound.ts`, unit-tested).
  Store: `IMPORT_SOUND` (onto the selected player, or a new `AudioStreamPlayer` under the selected node; both modes), `SET_AUDIO_SOUND`,
  `SET_AUDIO_PLAYER` (volume/pitch merge per drag; autoplay/loop one step each), all undoable, `sounds` is part of `EditState`. UI:
  Scene > **Import Sound...**; the Inspector of an AudioStreamPlayer is `AudioPlayerField.tsx` (an audio player: Sound select + Import
  Sound..., Play/Stop, position bar that seeks, `m:ss / m:ss`, Autoplay on load, Volume, Pitch, Loop) **instead of Position X/Y**; the
  preview is `audio/sound-preview.ts` (`SoundPreview` on Web Audio, using the DS's volume level and playback rate, settings apply
  live, stops when another node is selected); the Hardware tab has a sound-memory bar. Compiler: `DsSound`/`DsAudioPlayer`, the writer
  emits `sound_N_samples[] __attribute__((aligned(4)))` (odd counts padded with a silent sample), `scene.h` `GsSound`/`GsAudioPlayer`,
  and `main.c start_audio()` calls `soundEnable()` + `soundPlaySample(...)` for each autoplay player before the loop. Hidden players
  aren't compiled. **Verified by measuring real audio** (no one has to listen): `tools/ds-toolchain/measure-melonds-audio.ps1` reads
  Windows' per-application peak meter (WASAPI `IAudioMeterInformation`) for melonDS (`-Rom`) or for the editor's process tree
  (`-RootPid`); `sound.rom.test.ts` (9 ROM tests via `testing/audio-meter.ts`: autoplay plays, no-autoplay/no-player silent, 50%/25%
  volume read exactly half/quarter, non-looping 2 s sound lasts 2.05 s, 2x pitch 1.03 s, 0.5x 4.07 s, loops don't gap, two players
  double, a 1.97 MB sound plays) and `tests/prototypes/e2e/sound-player.mjs` (19 checks with an MP3: the editor's preview measured the same way,
  save/reopen/undo, and a UI-authored ROM run in melonDS at 40% volume and 1.5x pitch reading 0.1001 for 1.05 s). Deliberately breaking
  volume and pitch in the compiler fails those tests. MP3 verified once with a real 44.1 kHz file (`GSDS_TEST_MP3`); **OGG not exercised**
  (header sniffing only unit-tested). Playing a sound from a script is built (see "Scripting"). Not built: loop points, panning/stereo, ADPCM, streaming.
  Gotcha: DUPLICATE_NODE keeps the node's name (two rows named alike); the meter needs a sound output device.
- **Collision** (`collision/EPIC.collision-shapes.md`, done for the first slice). Decisions with the owner: shapes plus **overlap checks only, no physics** (the DS has
  no physics library); shapes **box, sphere, capsule, cylinder**; scripts **ask each frame** (`a.overlaps(b)`, no events); the editor **draws the shapes** as wireframes.
  I chose (Godot's meanings): a box's `size` is its full extents (default 1 x 1 x 1), radius 0.5, capsule/cylinder height 2 (a capsule's is the total, ends included, and
  is raised to twice its radius); capsules and cylinders stand along the node's own Y; the node's own scale and its parents' scale the shape (a sphere scaled unevenly is
  an ellipsoid); **a hidden shape (or under a hidden node) overlaps nothing**; a shape no script checks gets the warning `collision-shape-unused`. **Data:**
  `SceneNode.collision` (all fields optional in the file; `getCollisionShape` fills defaults and normalizes; schema ranges 0.01..1000; the editor stores every field once a shape
  is edited so each shape keeps its sizes). **Language:** `a.overlaps(b)` / `overlaps(b)` (= `self.overlaps(b)`), both sides `CollisionShape3D` (`$Name` or `self`); a mesh is an
  error saying to add a shape under it. **Compiler:** `DsCollider`/`DsNode.collider`, a `GsCollider` table in `scene_data.c`. **Runtime:** `runtime/source/gs_collision.c`:
  GJK, the distance form, on the shapes' support functions in 20.12 fixed point in 64 bits; `gs_shapes_overlap(a, b)` takes explicit placed shapes (so tests can drive it),
  `gs_overlaps(nodeA, nodeB)` (in `gs_api.h`) looks them up and first calls `gs_refresh_node` so a same-frame move is seen. **Lessons from running it on the DS:** the search
  direction must come from the simplex's exact edge/face normal, not from the (rounded) closest point, or a near-touching pair loops for the whole iteration cap; and the
  working range is 15 bits with products of dot products formed from shifted values. Costs about 0.4-0.8 ms a check (a handful per frame is fine). **Verified:**
  `collision.rom.test.ts` (55 hand-worked cases + seeded random pairs of all 16 shape combinations at three sizes against the independent oracle `testing/collision-oracle.ts`, a
  different method in double precision; `GSDS_COLLISION_STRESS=8` checked 5 175 pairs with no disagreement; a deliberate bug is caught), `collision-scene.rom.test.ts` (node-level
  `gs_overlaps`), `collision-game.rom.test.ts` (D-pad walks a player into a wall and a flag appears; and `GSDS_COLLISION_ROM_PROJECT` runs the game built by
  `tests/prototypes/e2e/collision-shapes.mjs` through the UI). **UI:** `panels/CollisionShapeField.tsx` (numbers keep their own text while focused), `viewport/collision-wireframe.ts` +
  `CollisionShapeView` in `Viewport3D.tsx` (the wireframe renders light teal, blue when selected; clicking the faint fill selects the node; Scale tool allowed on shapes), store
  action `SET_COLLISION_SHAPE`. **Rename:** `panels/NameField.tsx`, action `RENAME_NODE` (label "Rename X": typing merges, so the label can't carry the new name); the Inspector's old
  plain heading became this input, so E2E scripts read `input[aria-label="Name"]`. **Known limits:** near-touching is decided within about 0.001 units (more for very large shapes);
  no contact points, ray casts, layers, enter/exit events, mesh-shaped shapes or 2D collision (solid ground came later, see "Solid shapes"); no Scene-tree rename or auto-rewrite of `$Name` on rename.
- **Solid shapes** (`collision/STORY.solid-shapes-and-move-and-collide.md`, done). Decision with the owner: **solid shapes plus a move call** (floors, walls and
  ceilings; no moving platforms, slopes or step-up). **Data:** `collision.solid` (default false; the Inspector's **Solid** checkbox; solid shapes draw warm orange in
  the viewport). **Language:** `move_and_collide(dx, dy, dz)` (moves the node's `position`, returns whether it was stopped), `is_on_floor()`, `is_on_wall()`,
  `is_on_ceiling()` (as of the last move). A **body** is a node with collision shapes under it; the solid shapes it can hit are the visible `solid` ones not under it.
  The checker errors (naming the node) when the script's node has no shape under it. **Runtime** (`gs_collision.c`): per-axis (Y, X, Z) moves in steps of at most 0.25
  units, a blocked step is bisected 6 times and pulled back by a 0.01 skin; a body already inside a solid moves freely (so it can always get out). **Example:**
  `tests/prototypes/scripts/player-jump.gsscript`. **Lessons:** (1) measure on the DS: the first version cost 6.7 to 19 ms a call; an early return for a blocked step
  no longer than the skin, shifting the body's shapes instead of recomputing its subtree, and an exact test for two axis-aligned boxes brought it to 0.6 to 0.9 ms;
  (2) GJK in 20.12 needs an exact search direction (the normal of the simplex edge/face, not a rounded difference), a 15-bit working range with int64 products, and the
  DS's `div64`/`sqrt64`; the failures were a stall at 64 iterations and pairs 0.04 apart called overlapping. Tests: `collision-body`, `player-script`,
  `platformer-game` ROM suites, `e2e/platformer.mjs` (+ `GSDS_PLATFORMER_ROM_PROJECT`).
- **Choosing the 2D screen of a 3D project** (`scene-designer/STORY.choose-2d-screen-in-3d-project.md`, done). Decisions with the owner: New Project (3D only) asks "2D on top / 2D on bottom" (default
  bottom); changeable later from the toolbar (one undo step); the first slice makes the 2D screen **editable** (2D nodes can be added and arranged) but the ROM does **not** draw them yet
  (warning `two-d-node-not-built`). **Where it lives:** in the `screen` of the scene root (a Node3D): that is the 3D screen, the other is the 2D screen (`packages/core/src/screen-layout.ts`:
  `getThreeDScreen`, `getTwoDScreen`, `screenForKind`, `withThreeDScreen`); every node's `screen` follows from what draws it, and a swap rewrites them, so save/undo/dirty need nothing new
  and old files (root on top) open as 3D on top. `SET_TWO_D_SCREEN` + `screenRolesOf` in `editor-store.tsx`; `EditorShell` shows the 3D editor when the screen filter is the 3D screen and the
  dual-screen 2D view otherwise. A 3D project's Add Node menu also lists the 2D kinds (2D nodes go under the root). Compiler: `scene.screen = getThreeDScreen(project)`; the old
  `mixed-screens` error is gone. No runtime change. Tests: `screen-layout.test.ts` (8), `two-d-screen.test.ts` (8), `e2e/two-d-screen.mjs` (8, + `GSDS_TWO_D_ROM_PROJECT` ROM test).
- **Script auto-complete** (`scripting/TASK.script-autocomplete.md`, done). The suggestion logic is pure code in `packages/core/src/script/completion.ts` (`completeScript`, read from the
  text before the cursor, not a parse, since the script is half written; uses the checker's `ScriptSceneContext`); `CodeEditor.tsx` wraps it as a CodeMirror source
  (`@codemirror/autocomplete`) and `ScriptWorkspace.tsx` supplies the scene and attached nodes (`toAttachedContext`, shared with the diagnostics). Contexts: plain word (own locals,
  variables, functions; statements at line start; built-ins; members of the attached node), `$` (scene nodes with kinds), after a dot (per node kind; `Input.`; `x y z` after a vector),
  inside quotes (buttons, animation names, `$"node names"`), none in comments. Enter or Tab accepts (CodeMirror ignores keys for 75 ms after the list changes, which matters to E2E typing).
  Tests: `completion.test.ts` (30), `e2e/script-autocomplete.mjs` (9).
- **Animation** (`animation/EPIC.animation-player.md`, done for the first slice). Decisions with the owner: **node properties over time**, edited on a **timeline
  panel with keyframes**. **Data:** node kind `AnimationPlayer` (offered in 3D projects like `AudioStreamPlayer`), `SceneNode.animation?: AnimationPlayerData` (`core/src/animation.ts`:
  animations with length, loop, tracks of (node id, property) and keys; `sampleTrack`/`sampleAnimation` are the reference blend: linear, bool stepped, clamped outside the keys).
  Properties: position, rotation, scale, visible on 3D nodes; volume, pitch on audio players. The validator's `checkAnimations` rejects bad files. **Editor:** `ANIM_*` actions in
  `editor-store.tsx`, Inspector `AnimationPlayerField.tsx`, bottom-dock `AnimationPanel.tsx` (the panel stays on the last selected player so node values can be changed between
  keys; typed time edits merge into one undo step; a name another animation has is refused), preview in `Viewport3D.tsx` (display only, never an edit). **Language:**
  `$Anim.play("name")`, `stop()`, `is_playing()`, `speed_scale` (the name avoids clashing with a script's `speed`). **Runtime** (`gs_animation.c`): frame order is input, scripts,
  animations, node update, view/lights, draw, so an animation wins over a script in the same frame; one animation per player; autoplay starts at init. **Diagnostics:**
  `player-without-animations`, `animation-not-started`, `animation-target-missing`. **Tests:** `animation.rom.test.ts` (random tracks vs `sampleTrack`), `animation-game.rom.test.ts`,
  `e2e/animation.mjs` (+ `GSDS_ANIMATION_ROM_PROJECT`). **Limits:** no easing, blending, events, reverse or sprite-frame animation; keys can't be dragged with the mouse.
- **Scripting** (`scripting/EPIC.scripting.md`, done for the first slice). Decisions with the owner: **compile to C** (not an interpreter);
  a **GDScript-like** language; first slice = per-frame `_process`, buttons + touch, move/rotate/scale/show nodes, play sounds; scripts
  **embedded in the project** (`project.scripts: {id, name, source}[]`, `SceneNode.scriptId?`, one script per node, unused ones kept)
  and edited in the **Script tab** with CodeMirror 6. **Language:** `var` members, `func _ready()` / `func _process(delta)`, `if/elif/else`,
  `while`, `for i in range(..)`, `return/break/continue/pass`, int and `float` (**fixed-point 20.12**; int arithmetic wraps, `-fwrapv`;
  division by zero gives 0), `bool`, `$NodeName` static references (or `$"Name with spaces"`), `self`, `position/rotation/scale/
  visible` on nodes and `play()/stop()/volume/pitch` on audio players, `Input.pressed/held/released("a")` and touch, `abs min max
  clamp sqrt sin cos int float`, `overlaps` and `move_and_collide`/`is_on_*` (collision shapes, see below), and `play("name")`/`stop()`/`is_playing()`/`speed_scale` on AnimationPlayers. Each node a script is attached to gets its own copy of the script's variables. **Code:** the lexer/
  parser/checker in `packages/core/src/script/` are shared by the editor (live diagnostics, debounced 250 ms, against the current scene
  and the kinds of node it is attached to) and the compiler (`checkProjectScripts`; a script error fails the export naming script, line,
  column). `packages/compiler/src/script-codegen.ts` writes `script_code.c`. **Runtime:** a node table (`GsNode`), dynamic nodes (any
  node a script writes, plus descendants) recomposed each frame (Euler XYZ with libnds sin/cos tables, scale component-wise), effective
  visibility down the chain, first 4 visible lights, frame order: input, scripts, node update, view and lights, draw; `delta` is 68
  (60 fps) or 137 (30 fps) in 20.12. Hidden subtrees are only kept in the ROM if a script reaches them. **UI:** `ui/src/editor/script/
  {CodeEditor,ScriptWorkspace}.tsx`, `panels/ScriptField.tsx` (Inspector: choose/None/New Script/Edit on every node), store actions
  `CREATE/DELETE/RENAME_SCRIPT`, `SET_SCRIPT_SOURCE` (typing merges into one undo step per 1 s pause), `ATTACH_SCRIPT`,
  `SELECT_SCRIPT`; Ctrl+Z inside the code editor is CodeMirror's own undo, outside it is the scene's. **Verified:** no host gcc exists,
  so semantics run on the DS: `script-semantics.rom.test.ts` (139 checks, each result drawn as a colored 8x8 block in the frame
  buffer and read back from an emulator capture, with mutation checks), `script-runtime.rom.test.ts` (scenarios compared with a
  three.js render of the equivalent static scene, IoU >= 0.85, plus a full scene at 60/60), `script-input.rom.test.ts` (real key and
  touch events via `tools/ds-toolchain/melonds-input.ps1`, which runs a temporary copy of melonDS with keys bound because this machine's
  config binds none), `script-sound.rom.test.ts` (audio meter), and `tests/prototypes/e2e/script-editor.mjs` (14 checks in the real app;
  its exported project run on the emulator with `GSDS_SCRIPT_ROM_PROJECT`, IoU 0.996). **Known limits:** non-uniform scale under a
  rotated parent has no shear; `soundKill` on a reused channel could cut off another sound; the dynamic-camera fix (`-fno-strict-aliasing`)
  is a hypothesis that stopped the flake, not a proven cause; OGG never exercised; no signals, arrays, classes, vectors as values,
  runtime node creation, or in-editor run; no Scene-tree marker for nodes with scripts; 2D projects can write scripts but cannot compile yet.
  Gotchas: a script's node references are checked against node *names* (a name shared by two nodes is an "ambiguous" error); Bash heredocs with
  apostrophes and Python replacement strings break JS escapes on this machine, so use the Write/Edit tools for such text.
- **Lighting** (reported by the owner: "the ROM is very dark and the editor doesn't match"; fixed and now measured).
  `compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md`, `scene-designer/BUG.editor-lighting-differs-from-rom.md` and
  `scene-designer/STORY.directional-light-intensity.md`, all done. **Facts worth knowing:** (1) the DS transforms a normal by the *same
  matrix as a position and never renormalizes it*, so a mesh with any scale had normals of the wrong length and got **no light at
  all** in the ROM (measured: a plane scaled 3x read 60 at every angle; unscaled it read 247/158/60 at 0/60/90 degrees). Fix: the
  compiler splits each mesh's baked transform with `splitScale` (`matrix.ts`) into rotation+translation (`DsMesh.world`, unit axes) and
  `DsMesh.scale`; `main.c` multiplies the first into both matrices, then `glMatrixMode(GL_POSITION); glScalef32(...)` scales positions
  only. (2) On the DS every `glNormal` recomputes the vertex color as *emission + enabled lights*, so a scene with **no lights** drew
  black; `glColor` doesn't help; the fix is `glMaterialf(GL_EMISSION, lightCount > 0 ? black : mesh->diffuse)` (no lights = unlit,
  own color, full brightness, in the ROM and the editor). (3) The DS light is a *color*: vertex color = sum over lights of
  `(ambient + diffuse * cos) * lightColor`, clamped, per vertex, no tone mapping/gamma; ambient is 8/31, a plain mesh's diffuse 24/31,
  a textured mesh's 1. That model is in `packages/core/src/ds-lighting.ts` (`dsVertexBrightness`, shared constants). The editor's
  viewport used three.js's PBR lighting (a hidden 1/pi factor + ACES tone mapping): now `ds-lighting-material.ts` shades every mesh
  with a small per-vertex shader (lights register via `DirectionalLightMarker` -> `registerViewportLight`, synced per frame by
  `LightSync`; omni lights light nothing, as in the ROM; first four lights shade). A directional light's *position never matters*,
  only its -Z direction, so its gizmo now has an arrow, and a **new** DirectionalLight3D starts at rotation (-45, -30, 0)
  (`NEW_DIRECTIONAL_LIGHT_ROTATION`). **Intensity:** `SceneNode.light?: { intensity }` (0..1, absent = 1, schema-validated,
  undoable, merged per drag); on the DS it is the level of a white light `round(31 * intensity)` (`lightLevelFromIntensity`), so 31
  real steps and nothing brighter than white; the Inspector has an "Intensity" range slider with the DS level under it. Verified:
  `lighting.rom.test.ts` (10 ROM tests vs the formula) and `tests/prototypes/e2e/lighting-parity.mjs` (9 checks; the viewport reads
  255/205/164/66 at 0/45/60/90 degrees, the formula 255/205/165/66). Not built: light color (hue), shadows (the DS has none).
- `testing` — `EPIC.automated-testing.md` (`in-progress`). A runner now exists:
  **vitest 2** at the repo root (vitest 5 needs a newer Vite than the repo's 5).
  `pnpm test` runs `*.test.ts`; `pnpm test:rom` (`vitest.rom.config.ts`) runs
  `*.rom.test.ts`, which need the toolchain, melonDS and a desktop and open emulator
  windows. `TASK.compiler-and-rom-regression-tests.md` is `in-progress` (built, with
  gaps listed in it); `TASK.persistence-contract-tests.md` and
  `TASK.e2e-tests-for-editor-flows.md` are `proposed`. The prototype scripts they
  grow from are kept in `tests/prototypes/` (README has the commands).
- `tools/ds-toolchain/` — scripts to set up and use the DS toolchain and melonDS on
  Windows without admin (`setup-windows.ps1`, `make-rom.sh`,
  `capture-melonds.ps1`, `build-fixture-and-capture.ps1`; README explains why MSYS2
  and what capturing an emulator needs). The toolchain and melonDS are **installed on
  this machine** (devkitARM 16.1.0 under `C:\msys64\opt\devkitpro`; melonDS 1.1 via
  winget). Gotchas: `DEVKITPRO` is an MSYS-side path (`/opt/devkitpro`), not a
  Windows variable; `devkit-env.sh` doesn't put the compilers on `PATH`; inside MSYS2
  `/tmp` is not Git Bash's `/tmp` (use `/c/...` paths); devkitPro's own Windows
  installer can't be scripted; capture must be DPI-aware and the emulator window
  topmost.
- `startup-view` — built and verified end-to-end; Epic and all three
  stories `done` (landing screen, New Project with the mode-commitment
  rule, Open Existing Project listing recent projects).
- `project-list` — Epic `in-progress`; Spike, store Task and startup-list
  Story are `done`; only the Project menu's Open Recent remains. The
  recent-projects Spike (`SPIKE.recent-projects-storage.md`) decided: a JSON file (`recent-projects.json`, `formatVersion: 1`,
  schema-validated) in Electron's `userData` directory, read/written only
  by the main process; entries `{path, name, mode, lastOpenedAt}` with
  name/mode copied at record time; recorded by the main process on every
  successful Open and Save As (plain Save doesn't record; the renderer
  has no "record" operation); most-recent-first, deduped by resolved path
  (case-insensitive on Windows), capped at 10; existence checked at list
  time and missing entries shown flagged, never auto-pruned; a
  missing/corrupt file is an empty list, never an error. Code goes in
  `@goodstuff/persistence/recents/` as its own segregated
  `RecentProjectsReader` / `RecentProjectsWriter` ports. Rejected:
  renderer `localStorage` (dev vs. packaged origins differ), the OS
  recent-documents list (Electron can add/clear but not read it back),
  scanning a folder, storing it in project files. Tickets:
  `TASK.recent-projects-store.md` and
  `STORY.recent-projects-list-on-startup-view.md` (both `done`), and
  `project-menu/STORY.open-recent-in-project-menu.md` (`proposed`).
- `project-menu` — `EPIC.project-menu.md` (`in-progress`) holds the
  menu-ownership rule and decision table;
  `STORY.project-lifecycle-actions.md` and
  `STORY.unsaved-changes-guard.md` are `done` (Export ROM... is a compiler Story, also done);
  `STORY.open-recent-in-project-menu.md` is `proposed` (everything it
  needs now exists — only the menu section is left).

## Not built yet (known gaps — see `requirements/` tickets, above, for detail)
- Project file I/O, the startup view, and project-mode locking all work.
  Recent projects and the unsaved-changes guard work too. Still
  missing: automated JSON Schema generation (both schemas are
  hand-authored), the Project menu's Open Recent, 2D compilation and 2D
  sprite images (Export ROM and Play are built, for 3D; models,
  textures and sounds can be imported), and CI for any of the tests (`pnpm test` and
  `pnpm test:rom` run locally; the editor E2E prototypes are in `tests/prototypes/`). All tracked
  as real tickets rather than a prose list — this section intentionally
  stays short so it doesn't drift out of sync with them.
