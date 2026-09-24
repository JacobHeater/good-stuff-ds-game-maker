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
- `tests/prototypes/` — the kept, hand-rolled verification scripts (editor E2E,
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
  `Game`. Script/Game show a "not built yet" placeholder (they used to
  fall through to the 2D viewport, which would leak into 3D projects).
- **Scene menu vs. Project menu** — a deliberate split, written down in
  `requirements/project-menu/EPIC.project-menu.md`. A menu is named for
  what its actions operate on, and an action lives in exactly one menu.
  The **Scene menu** (`layout/SceneMenu.tsx`) edits the *contents* of the
  open scene: a single "Add {mode} Node" list (2D kinds for a 2D project,
  3D kinds plus `AudioStreamPlayer` for a 3D project — audio isn't drawn
  by either pipeline, so it's offered in both), Duplicate Node and Delete
  Node (disabled on the scene root). The **Project menu**
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
  a `mesh: { primitive, triangleCount }`.
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
- `scripting` — nothing built; an Epic plus a Spike on language/
  execution approach (also unresolved, same coupling as above).
- `audio` — retroactive Story for the modeled-but-silent
  `AudioStreamPlayer` node/budget counting, plus a forward Task for
  real playback (blocked on asset-import and runtime decisions).
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
  **How it's verified** (all real, against melonDS): `pnpm test` — 114 fast tests
  (shared geometry, matrix math checked against three.js itself, fixed point,
  translation, diagnostics, build driver with fakes); `pnpm test:rom` — 9
  emulator tests that build each fixture, run it, capture the top screen and
  compare its silhouette with an independent three.js render (IoU >= 0.85),
  including a project **authored through the real editor UI**
  (`node tests/prototypes/e2e/ui-to-rom.mjs`, then
  `GSDS_ROM_PROJECT=<saved path> pnpm test:rom`; scores 0.91), the bottom
  screen, and a full-budget scene (2028 triangles). Deliberately breaking the
  rotation order fails six tests. **Not verified:** lighting (checked by eye;
  silhouettes ignore shading), 30 FPS pacing (melonDS's title shows emulator
  speed, not presentation rate), and normals under non-uniform scale (wrong on
  the DS; not addressed).
  **What compiling turned up in the editor** (all ticketed): three defects,
  now **fixed** — the hardware budget's triangle counts didn't match what the
  viewport drew (sphere 480 vs 720, cylinder 40 vs 64; now one shared geometry in
  `packages/core/src/primitive-geometry.ts`, sphere 168 / cylinder 48, used by the
  viewport, budget and compiler), the viewport ignored a parent's transform and
  visibility (it drew a flat list; now `SceneNodeView` recurses), and a
  directional light's rotation did nothing in the editor (now it shines along its
  local -Z, as in Godot and the compiler). Still **open**: the UI can't create or
  change a mesh's primitive — every mesh added is a cube
  (`scene-designer/STORY.choose-mesh-primitive.md`); the FPS target isn't saved in
  the project (`scene-designer/TASK.save-fps-target-in-project.md`, so the compiler
  takes it as an option, default 60); and cameras/lights/meshes have no
  fov/active-camera/colors and the editor never shows the view through a
  `Camera3D` (`scene-designer/STORY.camera-light-and-material-properties.md`).
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
  hand-authored), the Project menu's Open Recent, undo/redo, an asset
  pipeline, scripting, 2D compilation (Export ROM and Play are built, for 3D), and CI for any of the tests (`pnpm test` and
  `pnpm test:rom` run locally; the editor E2E prototypes are in `tests/prototypes/`). All tracked
  as real tickets rather than a prose list — this section intentionally
  stays short so it doesn't drift out of sync with them.
