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
- `packages/compiler` (`@goodstuff/compiler`) — compiles a saved project into
  a Nintendo DS ROM: pure translation to DS-format scene data, diagnostics, a
  build driver that runs the devkitPro toolchain, a CLI, and the hand-written C
  runtimes: `runtime/` (3D projects) and `runtime2d/` (2D projects, sprites only so far). Depends only on core.
  See the `compiler` entry below.
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
- **Keyboard shortcuts** (`packages/ui/src/editor/state/keyboard-shortcuts.ts`, pure `resolveShortcut(event, context)`, 10 unit tests; one window `keydown`
  listener in `editor-store.tsx` reads the latest state from a ref and runs the command). **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** undo/redo/redo; **Ctrl+S** save (no dialog when the
  project has a file), **Ctrl+Shift+S** save as, **Ctrl+O** open, **Ctrl+Shift+E** export ROM, **F5** play; **Ctrl+D** duplicate, **Delete/Backspace** delete, **F2** rename
  (focuses the Inspector's Name field, text selected), **Escape** select the scene root, **Arrow keys** nudge the selected 2D node 1 px (**Shift** 8 px; a quick burst is
  one undo step); **Ctrl+1/2/3** the viewport / Script / Game tab; Q/W/E/R (3D tools) stay in `WorkspaceToolbar.tsx`. Cmd counts as Ctrl. Rules: nothing with no project open or
  behind the unsaved-changes prompt; the node shortcuts (duplicate, delete, rename, Escape, arrows) only on the 2D/3D workspaces and never on the scene root (rename excepted);
  typing keys (Delete, Backspace, arrows, Escape, Ctrl+D) belong to an input/select/textarea/code editor when it has focus, while Ctrl+S/O/Shift+E/F5/1-3 still work there;
  the code editor keeps its own Ctrl+Z/Y. Menu items show the hint: **`MenuItem`'s shortcut is drawn by CSS from `data-shortcut`** (plus `aria-keyshortcuts`), so a menu button's
  text is just its label; the E2E scripts click buttons by exact text, which broke when the hint was ordinary text (tests read the hint from `data-shortcut`). The old separate Ctrl+Z
  and Delete handlers were folded into this. Verified by `tests/prototypes/e2e/shortcuts.mjs` (9 checks) and `delete-key.mjs` (7), with `undo-redo`, `e2e`, `sprite-image`,
  `texture-mesh`, `script-editor` and `transform-tools` re-run. Not built: copy/paste, cut, select-all, tree navigation with the arrow keys, F5 verified only by unit test.
- **Node icons** (`packages/ui/src/editor/node-icons.ts`, `NodeIcon.tsx`): each node kind has an emoji glyph in `NODE_KIND_ICON`, and a kind
  can have a drawn 32 x 32 PNG instead, listed in `NODE_KIND_ICON_IMAGE` (files in `editor/icons/`, named after the kind). `NodeIcon` shows the image
  (16 px; 20 px on viewport markers) or falls back to the glyph, in the Scene Tree, the Scene menu and the 2D viewport. Only **Area2D** has a
  drawn icon so far (the owner's `Area.png`; `Hand.png` became the TouchArea2D and TouchArea3D icon). **App logo** (`Logo.png`, 32 x 32):
  shown left of the title in the menu bar (`editor/icons/Logo.png`, `MenuBar.tsx`) and set as the window/taskbar icon (`apps/desktop/resources/icon.png`, imported in
  `main/index.ts` with electron-vite's `?asset`). Not done: the packaged `.exe`/installer icon, which needs `apps/desktop/build/icon.png` (512 x 512 or larger) or `.ico`.

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
  (`STORY.compile-2d-scene-to-nds-rom.md`, now `in-progress`: sprites are built, see "2D sprites" below).
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
- **2D sprites** (`scene-designer/STORY.import-sprite-image.md`, done; tasks `persistence/TASK.embed-imported-sprites-in-project-file.md`,
  `compiler/TASK.compile-2d-sprites.md`; the old `SPIKE.sprite-image-import.md` is `done`; `compiler/STORY.compile-2d-scene-to-nds-rom.md` is `in-progress`).
  **This is the first slice of "2D making": a 2D project now compiles to a ROM that draws its `Sprite2D` images on both screens.**
  Decisions with the owner: first slice = sprite images end to end; **256-color paletted** images (index 0 transparent, so 255 visible colors);
  **only the DS's twelve sprite sizes** (8x8 ... 64x64 plus the wide and tall ones; a 64x16 is refused), never resized. I chose: more than 255
  colors is **reduced (median cut) with a warning**, not refused; alpha >= 128 is opaque; **one of the sprite engine's 16 extended palettes per
  distinct image per screen** (so at most 16 different images a screen, unlimited sprites up to 128 share them; 4-bit sprites not built);
  128 KB of sprite memory a screen (`DS_HARDWARE_PROFILE.graphics2D.spriteMemoryBytesPerScreen`); embedded and already converted, like textures.
  **Data:** `ImportedSprite { id, name, width, height, palette, pixels }` (`packages/core/src/imported-sprite.ts`, `createSpriteFromRgba`, pure),
  `project.sprites`, `SceneNode.spriteId`; `formatVersion` still 1. **Semantics:** a sprite is drawn centered on its `position` at absolute screen
  pixels (the 2D viewport never added parents' positions and the ROM matches it); **tree order is drawing order** (later = on top; `flattenSceneTreeInOrder`
  in core, because `flattenSceneTree` makes no order promise); only the node's own `visible` counts. **Compiler:** `translateScene2D`
  (`translate-scene-2d.ts`) -> `DsScene2D` (per screen: images with tile-ordered pixels, sprites in hardware order = reverse tree order) ->
  `writeScene2DDataC` -> `RomBuilder.build2D` with the separate `packages/compiler/runtime2d` (own Makefile/`main.c`; top screen = main engine, bottom =
  sub engine; sprite tiles in VRAM banks B/D, extended palettes in F/I mapped as LCD memory while written, then as palettes). `compileProject`
  picks by mode; `checkProject` is the diagnostics-only entry (Export ROM's pre-check); Play works unchanged. Diagnostics: errors `missing-sprite`,
  `too-many-sprites`, `too-many-sprite-palettes`, `sprite-memory`; warnings `sprite-without-image`, `sprite-off-screen`, `two-d-node-not-built`
  (TileMap, Label, audio, animation; AnimatedSprite2D was added later, see "Animated sprites"), `two-d-scripts-not-built`. **Editor:** Inspector "Image" field + "Import PNG..." + preview
  (`SpriteImageField`), Scene > "Import Sprite Image...", the 2D viewport draws the image (`viewport/sprite-image.ts` makes a data URL), Hardware
  tab per-screen sprite memory and palettes, store actions `IMPORT_SPRITE`/`SET_SPRITE_IMAGE` (undoable; `sprites` is part of `EditState`),
  main-process `assets.importSprite()`. **Also new: `SET_NODE_SCREEN`** — a node of a *2D* project can be put on either screen from the Inspector's
  Screen select (it used to be disabled, so a 2D project could only use the top screen); it stays disabled in 3D projects and for the scene root.
  **Gotcha found by the E2E test:** the renderer's CSP (`default-src 'self'`) blocked `data:` images; it now has `img-src 'self' data:`.
  **Verified:** `sprites-2d.rom.test.ts` runs the ROM in melonDS and compares both screens *pixel by pixel* with a reference painted from the
  images (`captureBothScreens` in `emulator-capture.ts`; backdrops are dark blue top / brown bottom so the capture finds the screens; match
  1.0000 top, 0.9993 bottom, incl. draw order swapped and a project authored through the real UI), `tests/prototypes/e2e/sprite-image.mjs`
  (11 checks; prints `GSDS_SPRITES_ROM_PROJECT=` for the ROM test), plus unit tests in core, persistence, ui and compiler. The 3D ROM suite still
  passes after the builder refactor (`RomBuilder.build` and `build2D` share `buildFrom`). **Not built:** tile maps, Label text,
  sprite rotation/scale, 16-color images, scripts/sound/animation in 2D ROMs, dragging a sprite between screens, and drawing the
  2D nodes of a *3D* project's 2D screen (still `two-d-node-not-built`). **Packaged path** for `runtime2d` (`compiler-runtime-2d`) is untried.
- **Scene instances** (owner: "make a player scene then drag it into the level scene like Godot"; story `scene-designer/STORY.scene-instances.md`, done). `SceneNode.instanceOf` = a scene id: the node stands for that whole scene, live (edit the scene, every instance changes). `expandSceneInstances(project, tree)` (core `project-scenes.ts`) replaces instances with the scene's tree (ids `<instance>/<node>`, 2D positions shifted by the instance's position minus the scene root's because 2D positions are absolute, nested instances, missing/cyclic = empty node); the compiler (`translateProject3D`, `translateScene2D`) and both viewports (`useShownSceneRoot`) use it, so the runtime is unchanged. Add by dragging a scene tab onto the Scene tree or Scene > Instantiate Scene (`SCENE_INSTANTIATE`; cycles refused). A non-start scene with no camera gets a default one when built. Inspector shows the source scene with an Open button; selecting inside an instance selects the instance (`outerNodeId`). **Verified:** unit tests (974 pass). **Not verified:** drag and drop and viewport drawing in the real app; no overrides inside an instance.
- **Labels / text** (first step of the owner's "make the engine good enough for a full 3D game" roadmap: labels/HUD, then game state + save, then physics (ray casts, trigger areas, layers), then animated 3D characters, then a small coin-collecting demo game to find blockers; story `scene-designer/STORY.labels-and-text.md`, done). A `Label` node (core `label.ts`: `LabelData {text, color 0-7}`, `getLabel`, `labelCell` = position rounded to the 8 x 8 grid, `labelDisplayText`) is text in the DS's 8 x 8 font on libnds's console (sub engine bank H in 3D projects; both engines, bank A / H, in 2D projects). `{}` in the text is replaced by the label's `value`. Scripts (3D projects only): `$Score.value = 5` (int), `$Msg.text = "Game Over"` (string literal only), `$Label.visible`; a label can't be moved or rotated by scripts. Compiler: `collectLabels` in `translate-scene-2d.ts` -> `DsScreen2D.labels`, `label-text.ts` (`fontSafeText`, `cString`), C `GsLabel` + `labelCount/labels` at the end of `GsScreen2D` (scene.h and scene2d.h), runtime `gs_labels.h` (identical in runtime/ and runtime2d/: console, redraw-all-when-dirty) + `runtime/source/gs_labels.c` (`gs_label_set_value/get_value/set_text`, follows the node's visibility). Gotchas: `consoleInit` overwrites BG palette entry 0 (= backdrop), so the 2D runtime sets the backdrops again after; console cursor `[row;colH` is 0-based; text past the last row is cut, not scrolled. Editor: `SET_LABEL` (`LabelChange`), `LabelFields.tsx` (text + 8 color swatches), viewport draws each character in its cell (`data-testid="label-text"`), drag snaps to the grid. **Verified:** unit tests (993 fast + 302 ui/persistence), emulator test `testing/labels.rom.test.ts` (cell, color, screen, script value/text/hide, in 2D and 3D ROMs). **Not verified:** the editor viewport/Inspector in the real app (no E2E); labels on the 3D screen (only the 2D screen has them); non-ASCII text (shown as ?).
- **Game state + save** (roadmap step 2; story `scripting/STORY.game-state-and-save.md`, done). `global var score = 0` (parsed as `VarDecl.global`) in any script makes a project-wide variable every script can use by bare name, in every scene, kept across `change_scene`. `collectProjectGlobals(scripts)` (core `script/globals.ts`) = the sorted union of all declarations (same name must agree on type + literal start value; max 64); passed to the checker as `ScriptSceneContext.globals` (`checkScriptOnNodes(..., sceneNames, globals)`); res `{kind:"global"}`; compiler puts them in `DsScene3D.globals` and `writeScriptCodeFileC` writes ONE `int32_t gs_global[]` (+ `gs_global_initial`, `gs_global_count`, `gs_global_signature` = FNV hash of names+types, `globalSignature()`); codegen uses `gs_global[i]`, not the per-node state struct. Save: `save_game()`, `load_game()`, `has_save()` (bools; `saveCall` res) -> runtime `gs_save.c`: header (magic, signature, count, checksum) + values, written by libfat to `gsds-<signature>.sav` on the SD card (homebrew has no cartridge save chip; melonDS/ndstool ROMs are "homebrew" so melonDS gives them no cart save), falling back to cartridge EEPROM/flash. The 3D Makefile now links `-lfat`. Editor: the script workspace passes project globals to the checker and completion (`global` keyword, `save_game` etc.). **Verified:** unit tests (1020 fast pass) and `testing/game-state.rom.test.ts` in melonDS: a global set in scene 1 is read in scene 2, and save then load through an SD image works (the test turns melonDS's DLDI setting on with a new image file and restores `melonDS.toml` after; melonDS only does an SD card with that on, and a plain Play in melonDS has none, so saving there says false). **Not verified:** the cartridge EEPROM fallback, real flash-card hardware, saving in 2D projects (they run no scripts); no delete_save, one save slot, only ints/floats/bools.
- **Ray casts** (roadmap step 3, reduced; story `collision/STORY.ray-casts.md`, done). `body.ray_cast(ox,oy,oz,dx,dy,dz,max) -> float` (or bare `ray_cast(...)` on self): distance along the ray to the nearest visible solid shape not under the body, -1.0 if none, 0 if it starts inside; exact for boxes (slab test in the box frame), marched with a 0.03 sphere via `gs_shapes_overlap` for other shapes; broad-phase reject by centre-vs-ray. Checker `rayCall` (marks `selfMoves` like `probe_solid` so the solids get built), codegen `gs_ray_cast`, runtime `gs_collision.c`. Verified on the DS by 13 cases in `collision-body.rom.test.ts` (0.8 ms vs 60 shapes). **Deliberately not built:** collision layers/masks, enter/exit events (poll `overlaps()` and keep a variable), which-shape-was-hit.
- **Animated 3D models (poses)** (roadmap step 4; story `scene-designer/STORY.animated-3d-models.md`, done). Only .obj import exists and the DS can't skin, so an animated model = several .obj files with identical triangles imported together (Scene > Import Animated Model, multi-select; main-process `importPoses` + core `mergeMeshFrames`) into one `ImportedMesh` with `frames[]` (extra poses; pose 0 = positions/normals). A MeshInstance3D whose model has poses uses the same `spriteAnimations` field and Animations UI as AnimatedSprite2D (frames = poses; `SpriteAnimationsField poseCount`); scripts `$Hero.play("walk")`/stop/is_playing (`animCall.mesh`; only when the mesh has animations). Compiler: a primitive per pose (`indexOfPrimitive(mesh, frame)`), `DsMesh.frameStart/frameCount/animation*`, `DsScene3D.meshFrames/meshAnimations`, `GsMesh` grew 5 fields and `GsScene` 3 (appended after sprites2D). Runtime `gs_mesh_anim.c` + `gs_mesh_primitive(i)` in `draw_mesh`. Rigid-part characters (child nodes + AnimationPlayer) already worked and remain the way to move parts. **Verified:** unit tests (1043) + `testing/animated-meshes.rom.test.ts` on melonDS. **Not verified:** the import dialog/Inspector in the real app. **Not built:** blending, viewport preview, skeleton baking/glTF.
- **Coin collector example + what it found** (roadmap step 5; stories `scene-designer/STORY.coin-collector-example.md`, `STORY.mesh-colors.md`, done). `createCoinGameProject()` (core `examples/coin-game.ts`) is a small game (player, coins, chaser, follow camera, HUD labels, best time saved); `examples/coin-collector.gsds` is generated from it (`GSDS_WRITE_EXAMPLES=1` with `persistence/src/json/example-projects.test.ts`); `fixture` builds go through `node packages/compiler/dist/cli.mjs compile examples/coin-collector.gsds out.nds`. Building it found: all meshes were one grey -> per-mesh **color** (`MeshInstance3DData.color` "#rrggbb", `mesh-color.ts`, Inspector picker, `SET_MESH_COLOR`, compiler diffuse, viewport); no randomness/angles -> `randi(n)`, `randf()`, `atan2(y,x)` builtins. Played on the DS CPU by `testing/coin-game.rom.test.ts` (20 cases, scripted button presses via `gs_keys_held`; each case resets nodes/scripts/globals/collision state first). **Still missing for a full game (see the story):** joining text and numbers, shared functions between scripts, arrays, collision layers, enter/exit events, pause, animated preview in the editor, per-scene music.
- **Rigged models (glTF/GLB)** (owner: import skeletal models; chose glTF, rigid skinning, clips, and bones animatable in the AnimationPlayer; story `scene-designer/STORY.rigged-models.md`, done). NB the DS *can* animate bones (matrix stack, Mario Kart DS) -- the earlier pose import exists only because .obj has no bones. core `gltf-import.ts`: `importGltf(input,name)` turns a glTF into a scene subtree: bones = plain `Node3D` nodes with the file rest pose, each triangle goes to its strongest bone as a `MeshInstance3D` under it (vertices in bone space via the inverse bind matrix), clips become an AnimationPlayer (sampled at 15/s, RDP-thinned, quaternion -> XYZ Euler continuous). No runtime changes: bones are ordinary animated nodes. Renderer does the parse (node ids come from its counter); main `pickRiggedModel` only reads bytes + external .bin files. Menu: Scene > Import Rigged Model. Test fixture `buildArm()` (core `gltf-test-fixture.ts`). **Verified:** unit tests + `testing/rigged-models.rom.test.ts` (arm swings on melonDS). **Not verified:** real Mixamo/Blender files, the dialog. **Not built:** FBX, textures, smooth skinning, retargeting.
- **Collision polygon: a hull that wraps a mesh** (owner: "collision polygon 2D and 3D...basicly wraps around the sprite or mesh"; chose a convex (not concave) approximation, usable as a solid, 3D first; story `collision/STORY.collision-polygon-wraps-mesh.md`, done). `CollisionShapeKind` gains `"convexHull"`: a `CollisionShape3D` with that shape wraps its **parent** `MeshInstance3D`'s real geometry. `core/convex-hull.ts` `approximateConvexHull(points)`: the mesh's own vertices farthest out along 26 fixed directions (a "26-DOP" — 6 axes, 8 corners, 12 edges), deduplicated; every point returned is a real vertex, never invented, so it's always genuinely convex (a very thin off-axis spike can be clipped a little short — an approximation, not a full quickhull). Computed fresh every compile (`translate-scene-3d.ts`), not baked once: the mesh's vertices go through its own world transform then the shape node's own undone (`transformPoint`/`invertAffine`, `matrix.ts`), so points are in the shape's local space, pre-scale, exactly like a box's half extents. Error `collision-hull-needs-mesh` when the parent isn't a MeshInstance3D or has no geometry. Runtime: `GS_SHAPE_HULL`'s "support point" is an O(point count) lookup over `GsShapeInst.hull` (not the O(1) formula the other four have); its bounding radius is precomputed at compile time into `p[0]` and reused exactly like a sphere's (`bound_radius`/`spread_of`), so the broad-phase reject stays cheap; works through the same GJK (`gs_shapes_overlap`) as every other shape, so `overlaps()`, solid `move_and_collide()`, `ray_cast()` and `probe_solid()` all just work with no new runtime algorithm. `hull_points` is a flat array shared by every hull collider (`GsCollider.hullStart/hullCount`, `GsScene.hullPoints`), which bumped `GsCollider`/`GsScene`'s field layout (existing exact-string C-output tests updated: `collision.test.ts`, `solid.test.ts`, `sounds.test.ts`; checked-in `scene_data.c` fallback regenerated via the CLI). Editor: "Convex Hull (wraps the mesh)" in the shape picker. **Verified:** unit tests (`convex-hull.test.ts`, `collision-hull.test.ts`, `matrix.test.ts`) and `testing/collision-hull.rom.test.ts` on melonDS (6 cases hand-checked against box geometry, since a cube mesh's hull is exactly its 8 corners: overlap, ray cast, solid move_and_collide); the existing 102-case collision oracle and other collision/rom-output/scenes ROM tests still pass unchanged. **Not built:** an exact (non-approximate) hull, a concave/exact-mesh collider, `CollisionShape2D` (still does nothing — a sprite's real alpha is available at import time for whenever that's picked up, but it's a separate piece of work), and a viewport wireframe preview for this shape kind.
- **Unlit meshes** (owner: "a toggle to make the 3D object react to lights or not"; story `scene-designer/STORY.unlit-meshes.md`, done). `MeshInstance3DData.unlit?: boolean` (absent = lit normally); when true the mesh always shows its own diffuse color at full brightness, exactly like the existing "a scene with no lights isn't lit at all" case, just per-mesh instead of scene-wide. `DsMesh.unlit` (bumped `GsMesh`'s layout — same exact-string-test/`scene_data.c`-regeneration ritual as the collision-hull work). Runtime (`main.c`): `draw_mesh` already had the unlit code path (`GL_EMISSION` = the mesh's diffuse when not lit, which is what a lightless scene already used) but it was one scene-wide condition; now `glPolyFmt` (which lights are enabled) and `lit` are computed **per mesh** in the draw loop, since a light bit left on would still add its contribution on top of the emission color even with `lit=false`. Editor parity: `ds-lighting-material.ts`'s DS-lighting shader gained a `uUnlit` uniform. Inspector: a checkbox next to the mesh color picker (`SET_MESH_UNLIT`). **Verified:** unit tests (1106 fast) and a `lighting.rom.test.ts` case (a plane lit edge-on, which reads nearly black normally, reads full brightness when unlit); the other 10 lighting cases plus `rom-output.rom.test.ts`/`animated-meshes.rom.test.ts` still pass unchanged. **Not built:** per-face unlit, a separate emissive color, unlit for 2D sprites (never lit to begin with).
- **Bug: node ids could collide across sessions** (owner report: instancing "Map" into "World" was intentional, but duplicating a node afterward made Map's contents look merged into the wrong node, "a recurring bug"; bug `scene-designer/BUG.node-ids-collide-across-sessions.md`, done). Root cause: `nextNodeId` (`scene-node.ts`) is one counter shared by every node kind that only ever counts up for as long as the app runs; opening a project never told it about ids an *earlier* session had already saved (with its own, unrelated count), so a session that duplicated/added enough nodes could eventually mint an id the file already had on some other node — two different nodes sharing an id, which breaks anything that looks a node up by id (scene-instance expansion, `findSceneNode`, `$Name` resolution). Fixed: `ensureNodeIdsAbove(ids)` scans for ids' trailing `-<n>` and raises the shared counter above the highest found (never backward); `editor-store.tsx`'s `loadProject` (opening AND creating a project) calls it with every id in every scene (`flattenAllScenes`, not just the active one, since they share the counter) before anything can be added or duplicated. **Verified:** unit tests (`core/node-id-collisions.test.ts`, `ui/.../node-id-collision.test.ts` — an end-to-end repro: a high-numbered "Map" scene instanced into "World", opened, then duplicate in World; the regression test was confirmed to actually fail with the fix reverted, then pass with it restored) plus the full 1111-test fast suite.
- **Bug: a scripted, rotated sprite crashed the ROM on hide** (owner report: melonDS showed libnds's own assertion screen, `sprite.h:532 oamSetHidden() cannot set hide on a RotateScale sprite`, after attaching a script to a Sprite2D in a 3D project; bug `scene-designer/BUG.script-hidden-rotating-sprite-asserts.md`, done). `gs_sprites.c`'s `follow()` (runs every frame for any script-reachable sprite) always called `oamSetHidden()` to match the node's `visible` — but the DS's hardware reuses that same OAM bit for "hidden" (ordinary sprite) vs. "double size" (a rotate/scale one), so libnds asserts rather than doing the wrong thing; a script that writes even just a sprite's position is enough for the compiler to give it a rotation matrix (`rotatable`, `translate-scene-2d.ts`), making it "rotate/scale." A *static* rotated sprite (set via project data, never touched by a script) was never `follow()`-ed at all, which is why the existing suite hadn't caught it — only the *combination* of rotate/scale + script-reachable triggers it. Fixed: hiding a rotate/scale sprite now calls `oamSetAffineIndex(oam, id, -1, false)` first (drops it out of rotate/scale mode, making `oamSetHidden` legal), and showing it again restores the affine index and reapplies the matrix (the angle/scale data itself lives in a separate slot, untouched by the mode switch). **Verified:** a new `testing/sprites-3d.rom.test.ts` case — a sprite whose script sets rotation then hides it in `_ready()` (so an unfixed build crashes on the very first frame) builds, boots and correctly shows the sprite absent (0.9993 match against a reference with that sprite marked invisible); the full 1111-test fast suite and the rest of the sprites-3d ROM suite still pass.
- **Mesh face culling** (owner: a mountain mesh showed as a solid dark shape instead of lit terrain, asked for "a toggle on mesh instances to fix this face culling"; story `scene-designer/STORY.mesh-face-culling.md`, done). The DS runtime always drew every mesh with culling off (both sides of every triangle) — forgiving of an import whose winding was never verified, at the cost of exactly this symptom: if winding disagrees with the normals, the camera-facing side can read as facing away from every light (a flat dark patch) instead of being culled and just not drawn. `MeshInstance3DData.cull?: "none" | "back" | "front"` (absent/`"none"` = today's always-both-sides default); `DsMesh.cull`/`GsMesh.cull` map to the geometry engine's own `POLY_CULL_NONE/BACK/FRONT` (bumped `GsMesh`'s layout again, same exact-string-test/`scene_data.c` ritual as `unlit` and the collision-hull work); `main.c`'s per-mesh `glPolyFmt` (already computed per mesh since the unlit fix) now folds in each mesh's own cull bits too. Editor parity: `Viewport3D.tsx`'s three.js `side` is now derived directly from `mesh.cull` (`none`→DoubleSide, `back`→FrontSide, `front`→BackSide), replacing the old plane-or-imported-only heuristic — closer to the ROM's real default (always double-sided for everything, not just planes/imports). Inspector: a "Face culling" dropdown (`SET_MESH_CULL`) next to the mesh color/unlit fields. **Verified:** unit tests and `testing/mesh-cull.rom.test.ts` on melonDS (a plane facing the camera: visible by default and with `cull: "back"`, genuinely vanishes with `cull: "front"`) — caught and fixed a bug in the *test* along the way (comparing a captured pixel against the backdrop's raw 5-bit color instead of its 8-bit-scaled PNG value, found via a debug dump of actual pixel readings), not in the feature; full 1117-test fast suite unaffected. **Not built:** flipping a mesh's own winding/normals outright (this changes what's drawn, not the source geometry) or auto-detecting a bad winding — the owner still picks `back`/`front` by eye.
- **Recalculate normals on import** (owner follow-up to the face-culling story above: turned out not to be culling — the mountain went dark only from certain camera angles/distances, not every angle, ruling out a uniformly-reversed mesh; story `scene-designer/STORY.recalculate-normals-on-import.md`, done). Root cause: the .obj parser (`obj-import.ts`) always trusted a face's own `vn` exactly as given, never checked against the triangle's real shape — a model whose normals partially disagree with its geometry (common from some terrain tools) imports faithfully, wrong parts and all; which faces read dark then depends on which ones the camera is looking at, matching the report exactly. Fixed: `ObjImportOptions.recalculateNormals?: boolean` skips trusting `vn` and always uses the triangle's own already-computed (cross-product) flat normal instead — geometrically guaranteed correct, at the cost of flat per-face shading instead of the file's smooth shading. Asked once per import via a native Yes/No dialog in the main process (`assets-ipc.ts`'s `askRecalculateNormals`, right after the file is picked, before parsing) rather than new renderer UI; applies to every file when importing an animated model's poses too. **Verified:** unit tests (a deliberately-wrong `vn` is trusted by default, correctly overridden with the option set, right warning message). **Not built:** fixing an already-imported model without re-importing it, and smooth (vertex-averaged) recalculated normals — only flat per-face ones, which suit faceted terrain like the owner's mountain.
- **Mesh transparency** (owner: "add support for transparent textures and be able to change transparency in our color picker"; story `scene-designer/STORY.mesh-transparency.md`, done). Texture transparency
  was already built (`STORY.mesh-textures.md`'s 1-bit on/off punch-through, uploaded as libnds's `GL_RGBA`/A1RGB5 format, which the DS GPU already punches through in hardware); what was missing was a *mesh's own*
  opacity — the runtime drew every polygon with a hardcoded `POLY_ALPHA(31)` (fully opaque). `MeshInstance3DData.alpha?: number` (0..1, absent = 1, the same 31-level scale as a light's intensity: `alphaLevelFromOpacity`/
  `getMeshOpacity` in `mesh-color.ts`, mirroring `lightLevelFromIntensity`/`getLightIntensity`); `DsMesh.alpha`/`GsMesh.alpha` (bumped `GsMesh`'s layout again — same exact-string-test/`scene_data.c` ritual as
  `unlit`/`cull`). Runtime (`main.c`): `glPolyFmt` now takes each mesh's own `POLY_ALPHA`; opaque meshes draw in a first pass and translucent ones in a second (the DS never depth-writes a translucent polygon, so
  drawing opaque first keeps a translucent mesh from being wrongly overdrawn later by opaque geometry behind it), each translucent mesh getting its own `POLY_ID` (so two different translucent meshes still sort
  against each other, while one mesh's own triangles sharing an ID hides its own seams instead of self-sorting them); alpha 0 skips the mesh entirely. Editor parity: `ds-lighting-material.ts` gained a `uOpacity`
  uniform plus `transparent`/`depthWrite` set to match the DS's own rule. Inspector: an `OpacityField` slider (styled after the light's `IntensityField`) next to the mesh color/cull fields (`SET_MESH_ALPHA`, merged
  like `SET_MESH_COLOR`). **Verified:** unit tests (`core/mesh-color.test.ts`, `compiler/mesh-alpha.test.ts`, `ui/.../mesh-alpha-edits.test.ts`) plus the full 1126-test fast suite; typecheck clean across
  core/persistence/compiler/ui. Owner follow-up: correct in the editor but every mesh still drew fully opaque in melonDS — the geometry engine stores a polygon's alpha regardless but never actually blends with
  it unless blending is turned on globally, which `main.c` never did; fixed with `glEnable(GL_BLEND)` at startup, right next to the existing `glEnable(GL_TEXTURE_2D)`. **Not verified:** the owner hasn't
  re-tried it in melonDS since this fix, and there's still no automated `testing/*.rom.test.ts` case for it (so a future regression here wouldn't be caught automatically). **Not built:** back-to-front resorting
  of translucent meshes against each other per frame, gradient/partial texel alpha (a hardware limit), or a single native RGBA color-picker control (the color swatch and the opacity slider are still two separate
  controls).
- **Current camera** (owner: "the Camera3D needs a current_camera option that is a toggle"; story `scene-designer/STORY.current-camera.md`, done; carves one piece out of the larger, still-`proposed`
  `STORY.camera-light-and-material-properties.md`). A scene could already hold several `Camera3D` nodes but had no way to say which one the ROM actually looks through -- the compiler silently used "the first one
  in the tree." `CameraData { current?: boolean }` (`node.camera`); `isCurrentCamera(node, camerasInScene)` (`scene-node.ts`) is the one place the rule lives: explicit `current: true` wins, else the first
  Camera3D in tree order (so an old project needs no migration). Compile-time only, like picking a project's start scene -- not script-settable (a runtime cutscene-camera switch would need the runtime's
  currently-compile-time-constant `gs_scene.cameraNode` to become mutable, called out as future scope, not built). `translate-scene-3d.ts`'s camera selection is now "the one marked current, else the old
  first-effectively-visible-or-first-in-tree fallback," and the `multiple-cameras` warning only fires when none is marked (no real ambiguity once one is picked). Inspector: a checkbox next to the light intensity
  field, gated to Camera3D (`SET_CAMERA_CURRENT`, mirrors `SCENE_SET_START`'s "mark this one, unmark the rest" pattern but walking a node tree instead of a flat scene-entries array; unchecking just clears the
  node's own explicit mark and is a no-op if it was only ever current by the tree-order fallback). **Verified:** unit tests (`core/current-camera.test.ts`, a `translate-scene-3d.test.ts` case, `ui/.../camera-current-edits.test.ts`)
  plus the full 1134-test fast suite; typecheck clean. **Not verified:** the checkbox in the real app, an actual ROM build with a non-default camera (no automated ROM/emulator case). **Not built:** field of
  view/near/far plane editing and a "view through the active camera" viewport mode (both still open in the parent story), and any script-settable runtime camera switch.
- **Bug: the live triangle budget ignored scene instances** (owner: "if a scene has any instatieated scenes it should add those to the triangle budget too"; bug `scene-designer/BUG.triangle-budget-ignores-scene-instances.md`,
  done). The compiler was never wrong -- `translate-project.ts` already expands every instance (`expandSceneInstances`) before building a scene, so the ROM's real triangle count and its budget diagnostic already
  included an instance's meshes. Only the editor's own live Hardware panel (`BottomPanel.tsx`'s `computeSceneBudget(state.sceneRoot, ...)`) disagreed, since an instance is one reference node with no children of its
  own in the un-expanded tree, so `computeSceneBudget`'s walk never saw what was inside it -- the gauge could read comfortably under budget for a scene the compiler would actually refuse. Fixed by reading the same
  expanded tree the viewports already draw (`useShownSceneRoot`) instead of `state.sceneRoot` directly, which also fixes the panel's node/sprite/sound/texture counts the same way, not just triangles. **Verified:**
  `core/budget.test.ts` (new) plus the full 1137-test fast suite and typecheck. **Not verified:** the Hardware panel in the real app (no E2E).
- **`var` can be a string** (owner: "let's add an update allowing var to be strings"; chose "named literals + equality checks" and "global strings too" from options; story `scripting/STORY.string-variables.md`, done). Version 1 of the
  language deliberately left strings out as a value type (only a literal could name something at compile time: a label's text, an animation/scene name, a button); this widens `ScriptType` to include `"string"`, with one
  deliberate, load-bearing restriction: a string variable can be declared from a literal, reassigned to another literal or string variable, passed to/returned from a function, and compared with `==`/`!=` -- no joining, no
  ordering, nothing else. That restriction means every value a string variable can ever hold is one of the literals already in the source, known at compile time, so it compiles to a plain pointer to a ROM constant
  (reusing `STORY.labels-and-text.md`'s existing `cString`/`fontSafeText`) instead of needing mutable string storage. `$Label.text = a_string_var` now works (it already compiled to a runtime pointer swap); `play("name")`/
  `change_scene("x")`/`Input.is_button_down("a")` still need an actual literal, since those resolve to a compile-time index, not a runtime value -- making them accept a variable would mean real new scope (runtime `strcmp`
  dispatch), not part of this change. Codegen: a local/member string var is a real `const char*` field (nothing reads the per-node state struct uniformly, so no reason to hide the type behind int32_t); a *global* string
  still lives in the numeric `gs_global[]` array, cast to/from `int32_t` (pointers and int32_t are both 32 bits on the DS); `==`/`!=` compiles to `strcmp(...) == 0`/`!= 0`, not pointer equality (two occurrences of the same
  text aren't guaranteed one address). Save-file safety: a string global's value is a ROM address, which a save file can't meaningfully round-trip between two builds that differ only in some unrelated string shifting ROM
  layout (the existing `gs_global_signature` guard doesn't catch this) -- `orderGlobalsForRuntime` (`translate-scene-3d.ts`) sorts every string global to the end of `gs_global[]`, and `gs_global_count` (the save file's own
  boundary) only spans the numeric prefix, so a string global is simply never saved/loaded, no runtime (`gs_save.c`) changes needed. **Verified:** unit tests across `core/script.test.ts`, `script-labels.test.ts`,
  `script-globals.test.ts`, `compiler/game-state.test.ts`, and a new `compiler/string-vars.test.ts`; full 1156-test fast suite and typecheck (core/persistence/compiler/ui) pass. **Not verified:** an actual ROM build (no
  automated ROM/emulator test) -- in particular the `(int32_t)(intptr_t)"text"` static initializer for a string global is a standard embedded-C pattern but hasn't been compiled by devkitARM yet. **Not built:** string
  concatenation/joining, ordering, any built-in string function, a variable naming an animation/scene/button dynamically.
- **Named audio clips** (owner: pasted a script doing `if time == "Morning": $Music.play("Morning") elif ...`, "a Audio player can hold up to 10 sounds cause i want to be able to do this"; chose "10 total" and
  "each with its own volume/pitch/loop" from options; story `audio/STORY.named-audio-clips.md`, done). An AudioStreamPlayer could only ever hold one sound, with `play()` taking no arguments; this adds up to
  `MAX_EXTRA_AUDIO_CLIPS` (9) more named ones (`AudioPlayerData.clips: AudioClip[]`, the player's own sound still counts as the tenth and is completely unaffected -- `play()`/`stop()` with no name mean exactly
  what they always did). `play("name")` resolves the name to a clip index at compile time the SAME way `play("name")` on an AnimationPlayer already resolves an animation name (`checker.ts`'s `checkAnimationCall`
  pattern, mirrored for audio: `ScriptSceneContext.attached[].sounds`, the "not in the same place in every player this script is attached to" check for a shared script). `DsAudioPlayer` gained `clipStart`/
  `clipCount` into a new scene-wide `DsAudioClip[]` table (the same shape as `GsMesh`'s mesh-pose `frameStart`/`frameCount`); a player can now have `sound: -1` (named clips only, no sound of its own -- exactly the
  owner's actual use case, a time-of-day music player never started bare). Every clip needs a real sound chosen or it's a compile error naming the clip (never silently skipped/reindexed, since the checker already
  baked each clip's position into every `play("name")` that resolved against it). Runtime: `gs_audio_play_clip(player, clip)` sets the player's live volume/pitch from the clip's own settings and starts it on the
  player's one hardware channel, same as `play()` always has; `gs_audio_play`/`gs_init_audio` made safe for `sound == -1`. Unlike the recent string-variables work, clips needed no save-file safety carve-out --
  a clip's sound is a normal, already-persisted asset-table index, not a raw ROM pointer. Inspector: a "Named sounds" list mirroring `AnimationPlayerField`'s animations list (New/rename/delete, then the selected
  clip's own sound/volume/pitch/loop). **Verified:** `core/script-audio.test.ts` (new), `script-animation.test.ts` (updated: `$Music.play("x")` is no longer an arity error), `compiler/named-audio-clips.test.ts`
  (new), `sounds.test.ts`/`collision.test.ts` (updated exact-string C), `ui/audio-clip-edits.test.ts` (new); full 1176-test fast suite and typecheck pass. **Not verified:** an actual ROM build, the Inspector in
  the real app. **Not built:** more than 9 clips, per-clip `is_playing()`/`stop("name")` (stop never needs a name: one channel, so it always stops whatever's playing), autoplay-by-name for a clip.
- **Multiple scenes** (owner's request; story `scene-designer/STORY.multiple-scenes.md`, done). `project.scene` is the *starting* scene's tree and `project.scenes` (`{ id, name, scene }`) the others, with `sceneId`/`sceneName` naming the start (absent for a one-scene project, so old files are unchanged); helpers in core `project-scenes.ts`. Scenes share the project's mode and assets/scripts; limits are checked per scene. **Scripts:** `change_scene("name")` (3D projects; a 2D ROM runs no scripts and holds only the start scene, warning `extra-scenes-not-built`). **Compiler:** `translateProject3D`, per-scene script names (`sc1_`), `gs_scene_scripts` + reset functions, `scene_data_<n>.c` + `scene_table.c`, `RomBuilder.buildScenes` (fallback `scene_data.c`/`scene_table.c`/`script_code.c` regenerated with the CLI: `scene-data`, `scene-table`, `script-code`). **Runtime:** `gs_scene` is `(*gs_scene_current)`; `main.c` `enter_scene(index, first)` sets a scene up, `gs_leave_scene()` puts the old one away (sounds, node/touch/collision/animation/sprite memory, textures), every init frees its old allocation, the switch is made when the frame ends. **Editor:** `activeSceneId` + `savedScenes` (unsaved compares every scene's tree by reference), `SCENE_*` actions (undoable; switching is not), `savedProjectOf(state)` for Save/Export/Play, `SceneTabs` above the viewport. **Verified:** unit tests (954 pass) and `scenes.rom.test.ts` (three scenes, two script-driven switches, only the last scene's sprite left, match 0.9993). **Not verified:** the tab strip in the real app (no E2E yet), switching back to an earlier scene on the DS, sounds across a switch.
- **Animated sprites from sprite sheets** (owner: "Animated sprites that allow sprite sheets"; story `scene-designer/STORY.animated-sprites.md`, done). **Data:** a sheet is an ordinary `ImportedSprite` with
  optional `frameWidth`/`frameHeight` (`width` x `height` are the whole sheet; frames numbered left to right, top to bottom; one shared 256-color palette, so a sheet costs one of a screen's 16
  palettes; the whole sheet counts against the 128 KB); `createSpriteFromRgba(..., { frame })` imports one (frame must be a DS sprite size and divide the sheet); `getSpriteFrames`,
  `getSpriteFramePixels`, `spriteToRgba(sprite, frame)`. Animations are on the node: `SceneNode.spriteAnimations = { animations: [{ name, frames, fps 1-60, loop }], start? }`
  (`core/src/sprite-animation.ts`: `parseFrameList` reads "0-3, 5, 3-1"). Schema + validator check the frame size, unique names, frames inside the sheet and the start. **Scripts** (3D projects):
  `play("name")`, `stop()`, `is_playing()` on an AnimatedSprite2D (`animCall` with `sprite: true`, name resolved to the node's own list, `gs_sprite_play/stop/is_playing(node)`), and the Sprite2D
  members (position, rotation, scale, visible); `speed_scale` is AnimationPlayer-only (new `speed` capability). **Compiler:** `collectSprites(project, screenOf, used, diagnostics, fps, live?)` (fps is new):
  `DsSpriteImage` has `frames` (width/height = one frame, tiles = frames one after another), `DsScreen2D.animations` (frames, `step` = animation frames per game frame in 20.12, loop), `DsSprite` has
  `animation` (starting animation, -1 none), `animationFirst`, `animationCount`; errors `animation-frame-out-of-range`, warning `animated-sprite-without-animations`; the two `scene.h`/`scene2d.h`
  structs and the writer gained `frameCount`, `GsSpriteAnimation`, the sprite fields and `animationCount/animations` on `GsScreen2D` (the fallback `scene_data.c` was regenerated). **Runtimes:** one block of
  sprite memory per frame, `gs_sprite_anim.h` (identical copy in `runtime/include` and `runtime2d/include`, a test checks it; no libnds in it) steps animations each game frame and the runtime
  points the hardware sprite at the frame with `oamSetGfx`. **Editor:** Inspector `SpriteSheetField` (sheet picker, Frame size select, "Import sheet PNG...", the sheet drawn with numbered frames) and
  `SpriteAnimationsField` (add, rename, frames as text, speed, loop, remove, Preview, "Plays at the start"); store actions `SPRITE_ANIM_ADD/SET/REMOVE/START`, `IMPORT_SPRITE`/`SET_SPRITE_IMAGE`/`SET_SPRITE_TRANSFORM`
  now accept an AnimatedSprite2D (a sheet arriving with nothing selected makes an AnimatedSprite2D playing all frames as "default"; a smaller sheet drops the frames it lacks); IPC `importSprite(frame?)`;
  the 2D viewport draws the starting frame. **Verified:** unit tests in core, persistence, compiler and ui; emulator `animated-sprites.rom.test.ts` (2D project top 1.0000 / bottom 0.9993 against a
  reference painted from the sheet, with a sprite that must have run 1-2-3 to end on 3; a 3D project whose script calls `play("go")` 0.9993) and the older `sprites-2d.rom`/`sprites-3d.rom` still pass;
  real app `tests/prototypes/e2e/animated-sprite.mjs` (9 checks; found a rejected name staying in its field and a preview that restarted every tick). **Bug found by a unit test:** sprite centering used the
  sheet's width, not one frame's. **Not built:** per-frame durations, playing backwards (write "3-0"), animation events, sheets with spacing, a live animated preview in the 2D viewport.
- **Duplicating and `$Name`** (owner's request: several Jenga blocks, each a duplicate with its own touch area). **Duplicate** (Ctrl+D or Scene > Duplicate Node) gives the copy its own name
  among its siblings with `copyName` in core: "JengaBlock" -> "JengaBlock2", then "JengaBlock3"; a name already ending in a number counts on from it ("JengaBlock2" -> "JengaBlock3", never
  "JengaBlock22"). **What is under the copy keeps its names** (as in Godot, names only have to differ within one parent), with new ids. **`$Name` in a script is now relative to the node the
  script is attached to, as in Godot:** `ScriptSceneContext.scope` (the node being checked as); the name is looked for **under that node first**, and only then anywhere in the scene (a
  name several nodes share under the node is ambiguous). `checkScriptOnNodes` (core, `script/check-on-nodes.ts`) checks a script once per attached node with that node as scope and reports
  a shared mistake once; the editor's Script tab diagnostics and the compiler both use it. In the compiler, attached nodes whose checks name the same nodes share one compiled script
  (one copy of the code, one set of variables per node, as before); a node that finds different nodes for its `$Name`s is compiled as a script of its own (so in the C a `$Name` is always
  one fixed node). Effect: the same `jenga-block.gsscript` on every copy of a block, each copy asking its own `JengaTouch` child. Not built: auto-complete of `$Name`.
- **Day/night timer cycling** (owner pasted a script with `section_of_day_timer`/`section_of_day_go_down_wait_ticks`/`section_of_day_go_down_amount`/`time` already declared but no logic using them, plus the
  earlier `$Music.play("Morning"/"Day"/"Night")` block gated on `time`; asked for "every time the section of day timer goes down the time changes it goes morning day night" — not an engine feature, just script
  content added to `tests/prototypes/scripts/day-night-cycle.gsscript`, exercising the recent named-audio-clips work end to end). Added an `update_section_of_day()` function, called from `_process` before the
  `time ==` checks: a per-frame `section_of_day_wait` counter ticks down to 0, then resets to `section_of_day_go_down_wait_ticks` and steps `section_of_day_timer` down by `section_of_day_go_down_amount` (the
  same "wait, then step" shape as the energy drain built earlier this session for `flight-8way.gsscript`); when `section_of_day_timer` itself runs out, `time` advances one step (Morning -> Mid-Day -> Night ->
  back to Morning) and `section_of_day_timer` resets to 100 for the new section. `location`, `$Label`, `$PlayerIcon` and `$Music` were already referenced in the owner's excerpt and are assumed declared/wired
  elsewhere in their actual project (not invented here). **Verified:** a new compile-check in `compiler/scripts.test.ts` ("the example scripts kept in tests/prototypes/scripts") attaches the real file alongside
  stand-in `$Label`/`$PlayerIcon`/`$Music` (with "Morning"/"Day"/"Night" clips) nodes and a tiny second script declaring `global var location`, and checks it compiles with no diagnostics; full 1177-test fast
  suite and typecheck pass. **Not verified:** an actual ROM build, or that this is the real file the owner's game uses (only the pasted excerpt was available, not the owner's actual project file).
- **Compressed sound (IMA-ADPCM)** (owner: "my songs are to big i need them compressed more"; chose "add real IMA-ADPCM compression"; story `audio/STORY.compressed-sound.md`, done). A sound was always stored and embedded in the ROM as plain mono 16-bit PCM, with resampling to a lower rate the only size lever; this adds the DS hardware's own compressed format (about a quarter the size, at no runtime cost since the hardware decodes it as it plays). "Import Sound..." now asks once per import, right after the file is chosen (before it's even read) -- the same `dialog.showMessageBox` pattern `askRecalculateNormals` already uses for "Import Model...": "Compress (ima-adpcm)" or "Don't compress (pcm16)", answer flowing back through `PickSoundResult.compress` -> `decodeSoundFile`'s new `compress` param -> `createSoundFromPcm`'s `format`. (First built as a silent default for every import, with a one-time "Compress" button in the Inspector to shrink existing pre-feature sounds in place without re-importing -- the owner preferred an explicit per-import question instead, so the default-and-button version was replaced with this; re-import is now how an existing sound gets compressed.) New `core/ima-adpcm.ts` (`encodeImaAdpcm`/`decodeImaAdpcm`, a from-scratch standard IMA-ADPCM codec: 4-byte header, one nibble a sample after the first, no periodic block resets so the DS can stream it from one continuous range); `ImportedSound` gained `format?`/`sampleCount?` (absent format means "pcm16", every sound saved before this existed); `getSoundByteSize` now reads the literal stored byte length directly instead of assuming two bytes a sample, so it already reports the real compressed size everywhere it's used (the sound-memory budget, the Inspector's byte-size readout) with no separate changes needed there. `createSoundFromPcm`'s budget-fit math (resample down until it fits) accounts for the chosen format's bytes-a-sample, so a compressed import goes much further before it needs resampling at all. **Compiler:** `DsSound` is now `{ format, bytes }` (the exact bytes to embed, read via new `rawSoundBytes` -- deliberately NOT `getSoundSamples`, which decodes back to PCM and would re-expand an ima-adpcm sound and lose the whole point); `GsSound` is now `{ byteCount, sampleRate, format, data }`, a libnds `SoundFormat` code instead of being hardcoded to 16-bit. **Runtime:** the one place a sound is played, `audio_start` in `gs_runtime.c`, now passes `sound->format`/`byteCount`/`data` to `soundPlaySample` instead of hardcoding `SoundFormat_16Bit` -- nothing else (volume, pitch, looping, named clips) needed to change. **Also fixed along the way:** the owner's real case was an existing multi-scene project whose (pre-this-feature, still pcm16) music overflowed the DS's ARM9 binary size limit at Play ("region 'lma9' overflowed") -- chasing that down the Play error toast's `collect2.exe: error: ld returned 1 exit status` turned out to be hiding the actually useful line, because `RomBuilder`'s `firstErrorLine` (`compiler/build/rom-builder.ts`) only ever kept the first line containing the word "error", and a linker's real complaint ("undefined reference to `symbol'") doesn't contain it -- a real, independent bug for any linker failure, now fixed to prefer (deduplicated) "undefined reference" lines when present. Also added: in dev, `play-ipc.ts` streams the full raw toolchain output to the main process's own console (`!app.isPackaged`-gated), so a build failure the short in-app message doesn't fully explain can still be read in full. A SEPARATE, bigger gap found but not fixed while investigating: textures/meshes/sounds shared across more than one scene are embedded once *per scene* in the ROM (`translateProject3D` compiles each scene independently, no project-wide dedup), so a big enough multi-scene project can still overflow the ARM9 limit even with every sound compressed. **Verified:** `core/ima-adpcm.test.ts` (new), `core/imported-sound.test.ts` (existing resample/clip/fit tests pinned to `format: "pcm16"` since they compare exact sample values; new tests for the ima-adpcm default), persistence validator tests, `compiler/sounds.test.ts` (updated exact-string C), `compiler/build/rom-builder.test.ts` (new: prefers/dedupes undefined-reference lines); full 1189-test fast suite and typecheck pass. The import-time dialog itself is untested Electron main-process code, same as its `askRecalculateNormals` sibling. **Not verified:** an actual ROM build or real DS/emulator playback (no `*.rom.test.ts` case) -- the algorithm matches the documented standard but hasn't been played back for real. **Not built:** a way to shrink a sound already in the project without re-importing its file; the project-wide asset-dedup fix for the separate gap above.
- **FPS-scaled triangle budget** (owner: "when some one targets 30 fps it should double there availible triangles"; story `scene-designer/STORY.fps-scaled-triangle-budget.md`, done). The DS's ~2048-triangle budget is how much the GPU draws in one frame's worth of time at the hardware's native 60fps; the editor's 30/60 toolbar switch (`fpsTarget`, still ephemeral editor-session state -- `TASK.save-fps-target-in-project.md` is the separate, still-proposed task to persist it on the project) already reached the compiler and editor as an option/state value, but both places that check the triangle budget -- the compiler's `over-triangle-budget` diagnostic (`translate-scene-3d.ts`) and the editor's live Hardware panel gauge (`BottomPanel.tsx` -> `computeSceneBudget`, `budget.ts`) -- ignored it and always used the raw 2048 constant. New `triangleBudgetFor(fpsTarget)` in core's `hardware.ts` (`approxTrianglesPerFrame * (60 / fpsTarget)`, so 4096 at 30fps); both checks now call it instead of reading the constant directly. `computeSceneBudget` gained an `fpsTarget` parameter (defaults to 60, like every other place this isn't yet persisted); `BottomPanel.tsx` now passes `state.fpsTarget` through. The static "Fixed hardware ceiling" reference list (general hardware facts, not a live reading) still shows the plain 60fps number, with a note that the gauge above it is the one that scales. **Verified:** `core/hardware.test.ts` (new), `core/budget.test.ts` (new: limit doubles at 30fps, defaults to 60fps with no target), `compiler/translate-scene-3d.test.ts` (new: a scene over budget at 60fps compiles cleanly at 30fps); full 1194-test fast suite and typecheck pass. **Not verified:** the Hardware panel gauge in the real app (no E2E); an actual 30fps ROM drawing more than 2048 triangles on real hardware/an emulator (reasoned from the frame-time math, not measured). **Not built:** `TASK.save-fps-target-in-project.md` itself -- this only makes the two existing fps-target-aware checks act on it for triangles; nothing further needed once that task lands.
- **Standalone 2D scripting, item 1 of a new epic** (owner: "2D dev is extremely under developed... lets make 2D Dev usable for a full game", then "any kind of game should be possible so do all of the necessarys"; epic `scene-designer/EPIC.full-2d-games.md`, story `STORY.standalone-2d-scripting.md`, done). Before this, a standalone 2D project's ROM was a static/animated picture: sprites and sprite-sheet animations drew and labels showed text, but nothing could run logic, read input, play a sound, detect a collision, scroll, or switch scenes -- all of which already worked for 2D nodes on the spare screen of a *3D* project, a different, much more capable compile path (`translate-scene-3d.ts` + the full `runtime/`). Investigating found this gap was cheap to close for scripting specifically: the checker and codegen (`checker.ts`, `script-codegen.ts`) already resolve a Sprite2D/Label/AnimatedSprite2D/TouchArea2D's members and `Input.*` entirely generically, off the node's kind, with zero dependency on any 3D content existing in the scene -- so `translate-scene-2d.ts` now calls the exact same `checkProjectScripts`/`orderGlobalsForRuntime`/`generateScriptCode` (newly exported from `translate-scene-3d.ts`) that a 3D project uses, unchanged. The 2D node table is simpler than 3D's (every node in `scripts.touchedIds`, no parent/world-matrix composition, since a 2D project's positions are always absolute screen pixels already). **The key safety decision:** rather than trying to detect and block every script call to a capability 2D hasn't built yet (sound, an AnimationPlayer, 3D-only collision, saving), `runtime2d` gained a full `gs_api.h` (the same shape generated code expects either way) with `gs_stubs2d.c` -- safe no-ops for everything not real yet, exactly mirroring the existing "`-1` index in, no-op out" contract 3D already documents for "a player with no sound." This means a script that reaches for sound today simply does nothing (like `play()` on a soundless 3D AudioStreamPlayer already does), never a build or link failure -- and every later epic item just replaces a stub instead of retrofitting safety. **Runtime:** new `gs_runtime2d.c` (node-state init, `gs_read_input` -- a verbatim port of the 3D runtime's input reading, none of it is 3D-specific); `main.c` gained `follow_sprite`/`set_matrix` (ported from the 3D runtime's `gs_sprites.c`), `gs_sprite_play/stop/is_playing` and `gs_label_set_value/get_value/set_text` (searching *both* screens by node index, since a standalone 2D project has two to search where a 3D project's 2D screen only ever had one), and the script dispatch itself (`_ready()` once before the first frame, `_process()` every frame after input, before sprites/labels update and `oamUpdate`). `scene2d.h`'s `GsSprite` gained the exact live-state fields `scene.h`'s already has; new `GsNode2D` + `GsScene2D.nodeCount`/`nodes`. **Verified with a real devkitARM compile-and-link check** (not an emulator run) of a hand-written project exercising every new path at once -- this caught one real bug before it shipped: `translate-scene-2d.ts` was writing a node's position as a plain pixel integer instead of the `f32` every other position in the engine uses, which would have sent every scripted sprite to a wildly wrong position the instant a script touched it. **Verified:** new `describe("scripting a 2D project", ...)` in `compiler/translate-scene-2d.test.ts` (node table/dynamic flag, label text/value, input/globals, named sprite-animation play, a script error reported exactly as in 3D, and a not-yet-built capability compiling to a safe stub call); existing 2D tests updated for `DsSprite`/`DsLabel` now always carrying their live-state fields; full 1201-test fast suite, typecheck, and the devkitARM build all pass. **Not verified:** actually running the built ROM (no emulator launch, no `*.rom.test.ts` yet). **Not built:** the rest of `EPIC.full-2d-games.md` -- sound, collision, camera/scrolling, tilemaps, AnimationPlayer, scene switching, saving, and 2D-viewport editor polish (gizmos, multi-select, pan/zoom), roughly in that order.
- **Standalone 2D sound, collision and camera, items 2-4 of the same epic** (owner: "lets add tilemaps, sound, collision and camera now"; epic `scene-designer/EPIC.full-2d-games.md`, stories `STORY.standalone-2d-sound.md`/`STORY.standalone-2d-collision.md`/`STORY.standalone-2d-camera.md`, all done; tilemaps, the 4th thing asked for, followed right after -- its own entry below). Built one at a time, each replacing a `gs_stubs2d.c` no-op from the scripting story with the real thing, in dependency order (sound and collision are self-contained; camera needs to exist before tilemap scrolling would). **Sound:** `translate-scene-2d.ts` gained `collectAudio`, a close port of `translateScene3D`'s own audio-player collection (same diagnostics/codes, same sound dedup); the one real difference is a 2D node's own `.visible` already decides whether a player starts at once, where 3D has to walk a parent-visibility chain. `DsAudioPlayer` gained an optional `node` field so a 2D node table (which only ever holds what a script needs, unlike 3D's "every node" table) lets `gs_node_audio_player` find a player by searching for the one whose own `node` field matches, rather than 3D's direct index-on-node-entry. `gs_runtime2d.c` gained a direct port of the 3D runtime's whole sound section. **Collision:** new `core/collision-shape-2d.ts` (`CollisionShape2DData`, a rect or circle, the same shape `touch-area.ts` already established); `checker.ts`'s `requireShape` (what `overlaps()` requires) now accepts `CollisionShape2D` alongside `CollisionShape3D`, and `isSpriteTarget` was widened to cover it too (same position/rotation/scale/visible member shape a sprite has) -- `move_and_collide`/floor-wall-ceiling stayed untouched, gated by a separate, still-3D-only `requireBody` check, confirmed unreachable from 2D. `collectCollision2D` gives a collider only to a script-reached `CollisionShape2D` (one nothing reaches isn't embedded at all); `gs_runtime2d.c` gained a real `gs_overlaps` (AABB for rect-rect, squared-distance for circle-circle, clamped-nearest-point for circle-rect), reading each shape's *live* position so a script moving a node moves its collider for free. **Camera:** new `isCameraTarget` (position only, no rotation/scale/visible, unlike `isSpriteTarget`) plus a fix to the existing whole-vector-copy check so `$Camera.position = $Player.position` -- an obvious "snap to target" pattern -- type-checks (it was being rejected since `Camera2D` wasn't in `isSpriteTarget`'s kind list). `translate-scene-2d.ts` collects each screen's first `Camera2D` in tree order (a second one gets a `multiple-cameras` warning and does nothing), adding top-level `DsScene2D.topCamera`/`bottomCamera` fields -- deliberately *not* inside the shared `DsScreen2D`/`GsScreen2D` shape 3D's own 2D screen also uses, to keep zero risk of regressing that proven path. Every `Sprite2D`/`AnimatedSprite2D` on a camera'd screen becomes dynamic even if nothing scripts it, since the DS's OAM sprite hardware has no global scroll register -- every sprite's hardware position has to be individually recomputed each frame once a camera exists, there's no shortcut. **A real bug caught and fixed before shipping:** the first version of this "reached by camera" rule applied to every node kind sharing the camera's screen, not just the two sprite kinds -- since every `SceneNode` (including groups, labels, `CollisionShape2D`, `AudioStreamPlayer`) defaults to `screen: "top"`, this would have silently swept an unrelated, unscripted `CollisionShape2D` into the node table and given it a real collider plus a spurious `collision-shape-unused` warning, just because a camera happened to exist on the project's (near-universal default) top screen. Caught by a test expecting a specific node-table index that came out wrong; fixed by narrowing the rule to exactly `Sprite2D`/`AnimatedSprite2D`/`Camera2D`. `main.c`'s `ScreenState` gained `cameraNode`, threaded through `load_screen` (which must set it explicitly -- `screens` is `static`, so an unset camera would default to node 0, not "none"); `follow_sprite` now subtracts the camera's own live position before rounding to pixels. **Verified with real devkitARM compile-and-link checks** (not emulator runs), one per story, each building on the previous story's own script/scene: sound (autoplay + named clip + live volume write), collision (two shapes checked with `overlaps()`), camera (a scripted camera, a sprite dynamic only because of it, a second screen's sprite untouched). **Verified:** new `describe` blocks per story in `compiler/translate-scene-2d.test.ts` and `core/script/script-sprite.test.ts`; full 886-test fast suite (`core`+`compiler`) and typecheck pass (the pre-existing `apps/desktop` typecheck failure over `ChildProcess.on/once` and the 3D runtime fallback CRLF mismatch are both unrelated, already-known environment issues, see below). **Not verified:** actually running any of the built ROMs (no emulator launch, no `*.rom.test.ts`). **Not built in this pass:** solid-body collision/`move_and_collide` for 2D, camera bounds/deadzone/follow helpers, and -- the 4th thing asked for in the same request -- tilemaps, picked up right after in its own pass (see the next entry below).
- **Standalone 2D tile maps, item 5 of the same epic and the last of the 4 things asked for** (same owner request as above; epic `scene-designer/EPIC.full-2d-games.md`, story `STORY.standalone-2d-tilemaps.md`, done). `TileMap` had been a reserved node kind with nothing behind it; the epic doc flagged it as needing "a real design spike" before building, since (unlike sound/collision/camera) there was no 3D precedent to port and it draws with DS background hardware, not the OAM sprite engine every other 2D node uses. **Key reuse decision:** a tile sheet is just an ordinary imported sprite sheet with an 8 x 8 frame size -- `getSpriteFrames`/`getSpriteFramePixels` already read an arbitrary equal-frame grid, so a TileMap imports its sheet through the *exact same* `importSprite` action an `AnimatedSprite2D` already uses, no new asset type or import pipeline. **Hardware research before writing any runtime code:** read libnds's own `video.h`/`background.h` headers directly (via the devkitARM toolchain already on this machine) rather than guessing VRAM bank/register behavior, and found a real constraint worth designing around: the DS's sub (bottom-screen) engine has only one enableable background-memory "slot," and bank C (128 KB) and bank H (32 KB, already used for the label console) are two alternative, *mutually exclusive* ways to provide it -- enabling both at once would electrically map two different physical banks onto the same address range. Decided: a screen's label and TileMap always share one bank (bank A, 128 KB, for main; bank C, 128 KB, for sub when a TileMap exists there, displacing the smaller bank H), at disjoint byte offsets (label at charBase 0/mapBase 8, unchanged; TileMap at charBase 2/mapBase 24, chosen to clear the label's footprint with room to spare) -- avoiding a second physical bank entirely rather than trying to extended-palette their way around the conflict. Tiles are 4bpp (15 colors + transparent, one of the hardware's 16 *shared* sub-palettes), not a sprite's independent 255-color palette -- a real, lower ceiling, not a simplification, since the one bank that could give the sub engine an independent palette (H) is the same bank already spoken for by its label. **Compiler:** `translate-scene-2d.ts` gained `collectTileMaps` -- one TileMap a screen (tree order decides which, a `multiple-tilemaps` warning for any more, the same rule `multiple-cameras` already uses), nibble-packs each sheet frame into the DS's 4bpp format with physical tile 0 reserved as an always-blank transparent tile (so an empty grid cell needs no special-casing at draw time), and validates frame size/color count/tile count against the real hardware ceilings (`tileset-wrong-frame-size`/`tileset-too-many-colors`/`tileset-too-many-tiles`) instead of silently truncating. The camera story's `reachedByCamera` rule was widened to include `TileMap`, so a map's node stays in the table and its scroll stays live whenever its screen has a camera, the same as a sprite. **Scripting:** new `tile_solid(x, y)` built-in (`checker.ts`), the same bare-self/named-target shape `overlaps()` already has, gated by a new `requireTileMap` rather than widening an existing check -- `solid` is indexed by *sheet frame*, not by cell, so marking one ground tile solid covers every cell painted with it. **Found and fixed along the way:** `completion.ts`'s (script autocomplete) one `shape` capability flag was doing double duty -- driving both `overlaps()` suggestions AND 3D's `body`/`move_and_collide` gating -- which meant `CollisionShape2D`'s `overlaps()` had never actually been offered by autocomplete since the 2D collision story shipped (adding it to `shape` would have wrongly suggested 3D-only body methods on a 2D shape too); split into a separate `shape2D` flag while adding `tileMap` for the new builtin. **Runtime:** new self-contained `gs_tilemap.h` (same pattern as `gs_labels.h`) for VRAM upload and per-frame scrolling (subtracting the screen's camera's live position, exactly like `follow_sprite` already does for sprites); `gs_tile_solid` itself lives in `gs_runtime2d.c` alongside `gs_overlaps`, since it's a read-only query, not a rendering concern. Deliberately kept out of the shared `DsScreen2D`/`GsScreen2D`/`scene.h` types a 3D project's own 2D screen also uses (new top-level `DsScene2D.tileMaps`/`GsScene2D.tileMaps` instead), so this carries zero risk to that already-proven path. **Editor:** a paint UI lives in a new Inspector field (`TileMapField.tsx`) -- click a tile in the sheet to pick it as the brush, drag across a grid to paint, a checkbox per sheet tile marks it solid -- deliberately NOT in the 2D viewport itself (`DualScreenViewport.tsx` doesn't render a TileMap marker at all yet, and giving it a live scrollable tile overlay is real viewport work the epic already calls out as its own, later, lower-priority item). **A real bug caught by a test, not by reasoning:** `core/tile-map.ts`'s `setTileSolid` originally always returned a new array even when the requested flag already matched what an unmarked tile already reads as (not solid) -- would have logged a spurious undo step and a spurious edit every time; a reducer test expecting a no-op (`toBe(state)`) caught it immediately. **Verified with two real devkitARM builds:** a scripted camera + sprite + TileMap together calling `tile_solid()`, and -- deliberately testing the riskiest part of the VRAM design -- a Label *and* a TileMap together on *both* screens at once, forcing the bottom screen's label onto bank C; both compiled and linked with no errors or warnings. **Verified:** new `core/tile-map.test.ts`, `core/script/script-tilemap.test.ts`, a `describe("tile maps", ...)` in `compiler/translate-scene-2d.test.ts`, `ui/state/tilemap-edits.test.ts`, and `persistence/json/tilemap-schema.test.ts`; full 1263-test fast suite and typecheck across every touched package pass. **Not verified:** actually running either built ROM (no emulator launch) -- the VRAM byte offsets and palette-bank choice are reasoned from the DS's documented hardware and confirmed against libnds's own headers, but never seen drawing for real. **Not built:** more than one tile layer a screen, a map bigger than 32 x 32 tiles (256 x 256 px -- the hardware wraps past that), solid-body collision resolution against the grid (deliberately out of scope, matching the 2D collision story's own "overlap/query only" philosophy), and any viewport-canvas rendering of a TileMap.
- `# Good Stuff DS Game Maker — Project Context

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
- `packages/compiler` (`@goodstuff/compiler`) — compiles a saved project into
  a Nintendo DS ROM: pure translation to DS-format scene data, diagnostics, a
  build driver that runs the devkitPro toolchain, a CLI, and the hand-written C
  runtimes: `runtime/` (3D projects) and `runtime2d/` (2D projects, sprites only so far). Depends only on core.
  See the `compiler` entry below.
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
- **Keyboard shortcuts** (`packages/ui/src/editor/state/keyboard-shortcuts.ts`, pure `resolveShortcut(event, context)`, 10 unit tests; one window `keydown`
  listener in `editor-store.tsx` reads the latest state from a ref and runs the command). **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** undo/redo/redo; **Ctrl+S** save (no dialog when the
  project has a file), **Ctrl+Shift+S** save as, **Ctrl+O** open, **Ctrl+Shift+E** export ROM, **F5** play; **Ctrl+D** duplicate, **Delete/Backspace** delete, **F2** rename
  (focuses the Inspector's Name field, text selected), **Escape** select the scene root, **Arrow keys** nudge the selected 2D node 1 px (**Shift** 8 px; a quick burst is
  one undo step); **Ctrl+1/2/3** the viewport / Script / Game tab; Q/W/E/R (3D tools) stay in `WorkspaceToolbar.tsx`. Cmd counts as Ctrl. Rules: nothing with no project open or
  behind the unsaved-changes prompt; the node shortcuts (duplicate, delete, rename, Escape, arrows) only on the 2D/3D workspaces and never on the scene root (rename excepted);
  typing keys (Delete, Backspace, arrows, Escape, Ctrl+D) belong to an input/select/textarea/code editor when it has focus, while Ctrl+S/O/Shift+E/F5/1-3 still work there;
  the code editor keeps its own Ctrl+Z/Y. Menu items show the hint: **`MenuItem`'s shortcut is drawn by CSS from `data-shortcut`** (plus `aria-keyshortcuts`), so a menu button's
  text is just its label; the E2E scripts click buttons by exact text, which broke when the hint was ordinary text (tests read the hint from `data-shortcut`). The old separate Ctrl+Z
  and Delete handlers were folded into this. Verified by `tests/prototypes/e2e/shortcuts.mjs` (9 checks) and `delete-key.mjs` (7), with `undo-redo`, `e2e`, `sprite-image`,
  `texture-mesh`, `script-editor` and `transform-tools` re-run. Not built: copy/paste, cut, select-all, tree navigation with the arrow keys, F5 verified only by unit test.
- **Node icons** (`packages/ui/src/editor/node-icons.ts`, `NodeIcon.tsx`): each node kind has an emoji glyph in `NODE_KIND_ICON`, and a kind
  can have a drawn 32 x 32 PNG instead, listed in `NODE_KIND_ICON_IMAGE` (files in `editor/icons/`, named after the kind). `NodeIcon` shows the image
  (16 px; 20 px on viewport markers) or falls back to the glyph, in the Scene Tree, the Scene menu and the 2D viewport. Only **Area2D** has a
  drawn icon so far (the owner's `Area.png`; `Hand.png` became the TouchArea2D and TouchArea3D icon). **App logo** (`Logo.png`, 32 x 32):
  shown left of the title in the menu bar (`editor/icons/Logo.png`, `MenuBar.tsx`) and set as the window/taskbar icon (`apps/desktop/resources/icon.png`, imported in
  `main/index.ts` with electron-vite's `?asset`). Not done: the packaged `.exe`/installer icon, which needs `apps/desktop/build/icon.png` (512 x 512 or larger) or `.ico`.

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
  (`STORY.compile-2d-scene-to-nds-rom.md`, now `in-progress`: sprites are built, see "2D sprites" below).
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
- **2D sprites** (`scene-designer/STORY.import-sprite-image.md`, done; tasks `persistence/TASK.embed-imported-sprites-in-project-file.md`,
  `compiler/TASK.compile-2d-sprites.md`; the old `SPIKE.sprite-image-import.md` is `done`; `compiler/STORY.compile-2d-scene-to-nds-rom.md` is `in-progress`).
  **This is the first slice of "2D making": a 2D project now compiles to a ROM that draws its `Sprite2D` images on both screens.**
  Decisions with the owner: first slice = sprite images end to end; **256-color paletted** images (index 0 transparent, so 255 visible colors);
  **only the DS's twelve sprite sizes** (8x8 ... 64x64 plus the wide and tall ones; a 64x16 is refused), never resized. I chose: more than 255
  colors is **reduced (median cut) with a warning**, not refused; alpha >= 128 is opaque; **one of the sprite engine's 16 extended palettes per
  distinct image per screen** (so at most 16 different images a screen, unlimited sprites up to 128 share them; 4-bit sprites not built);
  128 KB of sprite memory a screen (`DS_HARDWARE_PROFILE.graphics2D.spriteMemoryBytesPerScreen`); embedded and already converted, like textures.
  **Data:** `ImportedSprite { id, name, width, height, palette, pixels }` (`packages/core/src/imported-sprite.ts`, `createSpriteFromRgba`, pure),
  `project.sprites`, `SceneNode.spriteId`; `formatVersion` still 1. **Semantics:** a sprite is drawn centered on its `position` at absolute screen
  pixels (the 2D viewport never added parents' positions and the ROM matches it); **tree order is drawing order** (later = on top; `flattenSceneTreeInOrder`
  in core, because `flattenSceneTree` makes no order promise); only the node's own `visible` counts. **Compiler:** `translateScene2D`
  (`translate-scene-2d.ts`) -> `DsScene2D` (per screen: images with tile-ordered pixels, sprites in hardware order = reverse tree order) ->
  `writeScene2DDataC` -> `RomBuilder.build2D` with the separate `packages/compiler/runtime2d` (own Makefile/`main.c`; top screen = main engine, bottom =
  sub engine; sprite tiles in VRAM banks B/D, extended palettes in F/I mapped as LCD memory while written, then as palettes). `compileProject`
  picks by mode; `checkProject` is the diagnostics-only entry (Export ROM's pre-check); Play works unchanged. Diagnostics: errors `missing-sprite`,
  `too-many-sprites`, `too-many-sprite-palettes`, `sprite-memory`; warnings `sprite-without-image`, `sprite-off-screen`, `two-d-node-not-built`
  (TileMap, Label, audio, animation; AnimatedSprite2D was added later, see "Animated sprites"), `two-d-scripts-not-built`. **Editor:** Inspector "Image" field + "Import PNG..." + preview
  (`SpriteImageField`), Scene > "Import Sprite Image...", the 2D viewport draws the image (`viewport/sprite-image.ts` makes a data URL), Hardware
  tab per-screen sprite memory and palettes, store actions `IMPORT_SPRITE`/`SET_SPRITE_IMAGE` (undoable; `sprites` is part of `EditState`),
  main-process `assets.importSprite()`. **Also new: `SET_NODE_SCREEN`** — a node of a *2D* project can be put on either screen from the Inspector's
  Screen select (it used to be disabled, so a 2D project could only use the top screen); it stays disabled in 3D projects and for the scene root.
  **Gotcha found by the E2E test:** the renderer's CSP (`default-src 'self'`) blocked `data:` images; it now has `img-src 'self' data:`.
  **Verified:** `sprites-2d.rom.test.ts` runs the ROM in melonDS and compares both screens *pixel by pixel* with a reference painted from the
  images (`captureBothScreens` in `emulator-capture.ts`; backdrops are dark blue top / brown bottom so the capture finds the screens; match
  1.0000 top, 0.9993 bottom, incl. draw order swapped and a project authored through the real UI), `tests/prototypes/e2e/sprite-image.mjs`
  (11 checks; prints `GSDS_SPRITES_ROM_PROJECT=` for the ROM test), plus unit tests in core, persistence, ui and compiler. The 3D ROM suite still
  passes after the builder refactor (`RomBuilder.build` and `build2D` share `buildFrom`). **Not built:** tile maps, Label text,
  sprite rotation/scale, 16-color images, scripts/sound/animation in 2D ROMs, dragging a sprite between screens, and drawing the
  2D nodes of a *3D* project's 2D screen (still `two-d-node-not-built`). **Packaged path** for `runtime2d` (`compiler-runtime-2d`) is untried.
 still lists the whole scene,
  and there are no paths (`$Child/Grandchild`). Tests: `copyName` and scoped-lookup unit tests in core, `touch-areas.test.ts` (three blocks compile with no warnings, each asking a different touch
  area), `duplicate-names.test.ts` (store). Not run as a whole ROM on the emulator. The E2E scripts `shortcuts.mjs` and `sound-player.mjs` were updated for the new copy names.
- **Touch areas** (`touch/STORY.touch-areas.md`, `in-progress`; tasks `TASK.touch-area-editor.md`, `TASK.script-touch-area-queries.md`, `TASK.compile-touch-areas.md`, all done). New
  node kinds **TouchArea2D** and **TouchArea3D** that scripts ask whether the stylus is on them. Decisions with the owner: TouchArea2D = a **rectangle on the touch (bottom)
  screen** (`touchArea2D: { width, height }` pixels, default 64 x 64, max 256 x 192, centered on the node's position like a sprite); TouchArea3D = a **ray-picked volume**
  (`touchArea3D: { shape: box|sphere, size, radius }`; a ray from the camera through the touched pixel is tested against it, so the 3D scene must be on the bottom screen);
  scope = editor + scripts + ROM. **Script API** (by `$Name.` or bare on the node): `is_touched()`, `is_touch_pressed()` (one frame per press), `is_touch_released()` (lifted this
  frame after being on it; dragging out is not a release); the names are reserved. Model `core/src/touch-area.ts`; the kinds are in the per-mode kind lists (2D kind in every
  project, 3D kind in 3D projects only; `TouchArea2D` is a 2D visual kind, so it lives on a 3D project's 2D screen). **Compiler:** `DsTouchArea` (rect in pixels or box/sphere
  params in 20.12), `DsNode.touch`, `camera.tanHalfFov`; scene data gained `touchAreas[]`, a count and `tanHalfFov` (existing exact-output tests were updated); diagnostics
  `touch-area-unused`, `touch-area-not-touchable`. **Runtime** (`gs_runtime.c`): `gs_update_touch()` each frame after `gs_read_input()`; a volume is a soft-float ray test in the shape's
  own space (transpose of view x world, divided by the node's scale; slab test / discriminant; half line), only while the stylus is down. **Where it works:** a 3D project with 3D on
  top -> TouchArea2D works (2D screen = bottom); 3D on the bottom -> TouchArea3D works; a **2D project's ROM ignores scripts, so a TouchArea2D there does nothing**
  (`two-d-node-not-built`). **Editor:** Inspector fields (`TouchAreaFields.tsx`), a dashed teal rectangle in the 2D viewport, a teal wireframe in the 3D viewport, store actions
  `SET_TOUCH_AREA_2D/3D` (merged typing, undoable), the owner's `Hand.png` as the icon of both kinds (`editor/icons/TouchArea2D.png` and `TouchArea3D.png`). **Verified:** unit tests (core 16, persistence 3, compiler 13, store 8) and
  `testing/touch-areas.rom.test.ts` (a real stylus click in melonDS: inside/outside a rectangle, one press counted once while held 2 s, a box picked by a ray through the pixel where
  three.js says its origin is, a box stretched by its scale, a sphere). **One touch, one area (owner's request: grab one block at a time):** in `gs_update_touch`, a touch that goes down is owned by the nearest volume under it (rectangles: the last in the tree) until the stylus is lifted; only the owner reports `is_touched()`, and `is_touch_pressed()` is now true only on the touch's first frame; a touch that goes down on nothing owns nothing (areas it slides over report held, as before). Uses the ray depth from `ray_distance` and a Newton `soft_sqrt`. Emulator-verified with two overlapping volumes (`touch-areas.rom.test.ts`, 'one area'); the older touch emulator tests were not re-run. **Dragging:** `Input.touch_ground_x(h)` / `touch_ground_z(h)` (script built-ins; the world point where the stylus ray meets the plane y = h; checker `touchGround`, `gs_touch_ground`) plus vector copying (`$A.position = $B.position`) support `tests/prototypes/scripts/jenga-block.gsscript` (pick up on `$JengaTouch.is_touch_pressed()`, follow the stylus with `move_and_collide` in steps of at most `max_drag_step`, the touch area a child of the block, 3D scene on the bottom screen); the ground mapping is emulator-tested against three.js's projection, the script itself is only compile-checked (`touch-areas.test.ts`). **That emulator file is timing-sensitive**: the click sometimes lands before the window settles and is lost, so
  hits are retried (`touchSeen`, fresh geometry each time, up to 3) and a miss is only believed after a hit on the same ROM. **Not verified:** `is_touch_released()` on the
  emulator (the input tool holds a touch until the picture is taken). Not built: touch in 2D projects, occlusion between areas, touch position inside the area, other 3D shapes.
- **Sprites on the 2D screen of a 3D project** (`scene-designer/STORY.sprites-on-the-2d-screen-of-a-3d-project.md`, `in-progress`): the first slice of the 2D screen in a 3D ROM is built —
  **`Sprite2D` nodes are drawn** (before this the ROM left that screen blank and warned `two-d-node-not-built`). Decisions with the owner: first slice = sprites only; **VRAM split only when
  needed**: a 3D project keeps 512 KB of textures until a sprite is drawn on its 2D screen, then bank D holds the sprite tiles and textures get banks A-C (**384 KB**;
  `textureMemoryLimit` in core, used by the compiler's `texture-memory` check and the Hardware tab). **How:** `collectSprites` (`translate-scene-2d.ts`, shared with 2D projects) collects the
  sprites of the project's 2D screen into `DsScene3D.sprites2D` (same rules as a 2D project: centered on position, tree order, own visibility, 128 sprites / 16 images / 128 KB); the writer's
  `writeScreen2DC` writes them for both runtimes; `scene.h` has `GsScreen2D sprites2D` as the last `GsScene` field; the runtime's `gs_sprites.c` (`gs_init_sprites`, `gs_update_sprites` right after
  the vertical blank) uses the **sub engine** (3D is the main engine, so the 2D screen is always the sub engine's; tiles in bank D, palettes in bank I) and `main.c` maps bank D as sprite memory
  instead of texture memory when there are sprites. Which screen a sprite is on follows from the project (its 2D screen), not the node's `screen`. The 2D screen's backdrop is black.
  **Verified:** `sprites-on-3d.test.ts` (9), `testing/sprites-3d.rom.test.ts` (3D on top, 3D on the bottom, and a textured mesh next to sprites: sprites match the painted reference at 0.9993-1.0,
  cube silhouette 0.93-0.98; shared helpers in `testing/sprite-reference.ts`, and `captureBothScreens` takes which physical screen has the bluish 3D backdrop), `e2e/sprites-3d-project.mjs` (5). The
  other 2D kinds still warn `two-d-node-not-built` ("only draws Sprite2D there so far"). **Not built:** scripts reading/moving 2D nodes (`position`/`visible` of a Sprite2D), Label text, tile maps,
  animated sprites. Also fixed two stale E2E expectations (`export-rom.mjs` still expected 2D export to be unsupported; `two-d-screen.mjs` the old warning text).
- **Scripting and rotating 2D nodes** (`scene-designer/STORY.script-and-rotate-2d-nodes.md`, done). Decisions with the owner: **scope = the 2D screen of a 3D project** (the only place scripts run;
  2D projects' ROMs still run none); properties **position, rotation, scale and visible**, with Inspector fields. A Sprite2D has `transform2D?: { rotation?, scale? }` (`core/src/sprite-transform.ts`;
  degrees **clockwise**, scale per axis 1/16..8 with the sign a flip). **Script members on a Sprite2D:** `position.x/.y` (pixels), `rotation` (one number), `scale.x/.y`, `visible`; the checker's
  `isSpriteTarget`/`spriteMember` resolve rotation to `nodeAxis` axis 2, so the C is `gs_node_state[n].rotation[2]`; `.z` and `rotation.x` are errors; vector copies stay within 2D or within 3D;
  a member of a number is now an error. **Hardware:** a sprite that starts rotated/scaled or that a script writes gets one of the sub engine's **32 rotation matrices** (`too-many-rotating-sprites`) and is
  drawn in a box twice its size (corner = center minus a whole picture size); the compiler can't tell a move from a turn, so a moved sprite gets a matrix too. `collectSprites` takes a
  `SpriteLiveness` (node index, "a script reaches it", "needs a matrix"); `DsSprite` gained `node`, `dynamic`, `affine`, `rotation`, `scaleX/Y`; the 3D form of `GsSprite` carries them; `gs_sprites.c`
  `follow()` updates a dynamic sprite from `gs_node_state` each frame (`oamRotateScale`, `oamSetXY`, `oamSetHidden`) before `oamUpdate`; a hidden sprite a script names is kept (starts hidden), an off-screen one
  is kept if it can turn or be moved. **Editor:** `SpriteTransformField`, `SET_SPRITE_TRANSFORM` (typing merges), the 2D viewport uses CSS `rotate`/`scale` on the picture, auto-complete offers the members.
  **Verified:** 826 fast tests, and one emulator test (rotated 90 and 30 degrees, stretched, mirrored: 0.9855 against a painted reference, which confirmed the direction). **Not run:** a script moving a sprite on the
  emulator, the real-app Inspector, and the older ROM/E2E suites after these runtime changes. Not built: 2D-project scripts, animating sprite rotation, other pivots.
- **Selecting and reordering nodes in the Scene tree** (`node-list/STORY.select-and-reorder-nodes.md`, done). **Ctrl+click** (Cmd) toggles a row in the selection, **Shift+click** selects the range from the
  anchor (the row last clicked without Shift) to the row, in tree order, replacing the rest; a plain click selects one. State: `selectedNodeId` is the **primary** (Inspector and viewports), `extraSelectedIds` the
  others, `selectionAnchorId`; `selectedNodeIdsOf(state)`; `normalizeSelection` (wraps the reducer) drops gone nodes and clears the extras when the primary changes by anything but a modified click or a duplicate;
  the Inspector shows a note ("N nodes are selected"). **Delete/Backspace, Ctrl+D, Scene > Duplicate/Delete Node act on the whole selection** (actions `DELETE_NODES`/`DUPLICATE_NODES`, one undo step; the
  shortcut "selectedIsRoot" now means nothing but the root is selected; the old `DELETE_NODE`/`DUPLICATE_NODE` by id remain). **Reordering is drag and drop** in `SceneTreePanel`: top quarter of a row = before, bottom
  quarter = after, middle = inside (last child; the root only takes children); dragging a selected row moves the whole selection (tree order kept), an unselected row moves alone; `MOVE_NODES`, pure core
  `moveSceneNodes`/`topMostNodes` (`scene-node.ts`), `canMoveNodes` lets the tree show only valid drops. Refused: into itself or its subtree, beside the root, no change; **in a 3D project a 2D node isn't nested under a 3D node
  or the reverse** (same rule as ADD_NODE; players and the root take anything). Local transforms are kept on reparenting. Verified: `scene-move.test.ts` (10), `multi-select.test.ts` (12),
  `e2e/tree-select-reorder.mjs` (4; the drag is played as DOM drag events since CDP can't drive a real one, so a real mouse drag is untried). Not built: Ctrl+A, Alt+arrow reordering, collapsing, multi-node Inspector.
  **Editing gotcha:** a heredoc containing backticks or apostrophes breaks on this machine, and a `sed` with `\`` in its pattern means start-of-line and corrupted `scene-node.ts` once (fixed): use the Write/Edit tools for
  code with backticks.
- **Folding nodes in the Scene tree** (`node-list/STORY.collapse-nodes-in-the-tree.md`, done). Every row with children has an arrow (▼/▶) that folds its children away; a folded row shows a count of the nodes hidden
  inside; the tree header has **Collapse all** (▶▶; the scene root stays open) and **Expand all** (▼▼). `EditorState.collapsedNodeIds`, actions `TOGGLE_COLLAPSED`/`COLLAPSE_ALL`/`EXPAND_ALL`, helpers
  `visibleNodeIds`/`ancestorIds`/`nearestVisibleId`. **Only a look:** not saved, not an edit (no undo step, not "unsaved"), reset when a project opens. **Selection follows what is shown:** folding takes the selected
  nodes inside out of the selection (the folded node becomes primary if the primary was inside); a Shift+click range runs over shown rows (a hidden anchor counts as its folded ancestor); selecting a node inside a fold
  from elsewhere (new node, viewport, undo) unfolds only the way to it (`normalizeSelection`); dropping into a folded node opens it; deleted ids are forgotten. Verified: `state/collapse.test.ts` (12) and a
  folding check in `e2e/tree-select-reorder.mjs` (now 5 checks). Not built: keyboard folding (arrow keys nudge the selected node), remembering folds, double-click.
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
  Gotcha: the meter needs a sound output device. (DUPLICATE_NODE used to keep the node's name; it now numbers the copy, see "Duplicating and `$Name`" below.)
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
  `is_on_ceiling()` (as of the last move), and **`probe_solid(y, x0, x1, x2)`** (owner's Jenga request: a block must know what holds it): which of three points, given in the frame of the body's **first collision shape** (its centre, turn and scale apply, so a shape lifted off the node's origin or turned a quarter about Y is probed the way it sits; y up from the shape's centre; x along the shape's **longer horizontal side**: its Z for a box longer in Z than in X, its X otherwise), are inside a visible solid shape that is not under the body; the answer is an int, 1 for the first point, 2 the second, 4 the third, added up. Checker `probeCall` (counts as using the solids like a move, writes nothing), `gs_probe_solid` in `gs_collision.c` (one pass over the solids for all three points, each a tiny sphere through `gs_shapes_overlap`), a completion entry. Emulator-verified (`collision-body.rom.test.ts`: on a floor 7, in the air 0, over a platform's edge 3 / 6, rotated a quarter turn 6, a Z-long lifted shape 3). **The first version probed in the node's own frame along its X, which did not match the owner's real Jenga project** (`Jenga.gsds` in their OneDrive Documents: blocks 0.6 x 0.3 x 1.8, long side along the shape's Z, the JengaCollision shape lifted 0.2609 above the block's origin, cross layers made by turning the *shape* 90 degrees): the probes sampled the wrong points, so blocks were judged held or loose at random and the tower looked broken (a screenshot showed layers hovering apart). Lesson: **read the owner's actual project file** (path in `%APPDATA%/@goodstuff/desktop/recent-projects.json`) before tuning a script to it. The example script now reads its shape's turn (`$JengaCollision.rotation.y`, 0 or +-90) to know which way the block lies and tilts with `rotation.x` or `rotation.z` to match. **Checked on the DS with the owner's real project** (a temporary emulator test that swapped the example script into a copy of the project's scene and stepped all scripts 30 frames a second; not kept, it depends on a file outside the repo): the 24-block tower settles into a compact stack (the authored 0.05 to 0.08 gaps between layers close, nothing tips), and with two of the three supports pulled from under the top layer its three blocks tip about the held end and lean at about 10 degrees on the layer below. **Jenga collapse, round 2** (owner, with a picture of a tower that only shuffled into a stable lean: "does not feel like Jenga at all"): the example script (`jenga-block.gsscript`) now needs a **`Node3D` named `Tower`** in the scene (blocks talk through it: `position.y` = how many blocks are moving, `position.x` = the tower-is-coming-down flag). Blocks that **let go** (a tip past `tip_limit`, a slide that comes off its support, a block that loses its support) keep their motion: they drift, spin and tumble (`vx/vz`, `spin`), a turn in the air is refused if it would push a corner into something (a hair-sized move down is refused exactly when the body touches or is inside a solid), a hard landing (`impact_speed`) kicks a block sideways and sets it turning so stacks end up out of true, blocks look every 0.2 s (`check_interval`), a block that has slid out from under a load goes at up to 2.5 units/s, nothing decides what to do in the first second (`calm`: the blocks above haven't landed), and a tipping block re-checks for a load every 0.12 s (a load arriving turns the tip into a slide). When `collapse_count` (4) blocks move at once, every block at rest is thrown outward once (`blow`), and a block that falls 20 units below its start is retired (`gone`). Watched in real emulator screenshots (a project copy with the outer two blocks of the bottom layer hidden, built with the CLI and captured with `capture-melonds.ps1`): the tower on one block comes down into a scattered pile, **but far too slowly**: **the real cost was the runtime, not the rules** (per script instance in the owner's 30-block tower: 7 ms for a settling block, 60 to 100 ms mid-collapse; a frame took 0.2 to 1.4 s). Runtime fixes, all in `packages/compiler/runtime`: (1) `compose_node` remembers what each node was composed from (its 9 numbers and its parent's version) and skips it when nothing changed: a move refreshed every nearby solid and in a tower that is all of them (7 to 2 ms per block); (2) `gs_shapes_overlap` has an exact box-box separating-axis test (`obb_overlap`, 15 axes, 32-bit multiplies) so turned boxes no longer go through the search (mid-collapse 60 to 100 ms down to 0 to 22 ms per block); (3) `angle_of` divided a 64-bit number by a constant, a library call of about 700 cycles six times per node composed: it is `degrees / 45`. Verified after (1) and (2): all four collision emulator suites (`collision.rom` 102 including the random pairs against the oracle, `collision-scene.rom` 21, `collision-body.rom` 38, `player-script.rom` 22). **Not re-measured after (3), and the real game's frame rate was not re-checked**: at last measure the script cost was about 46 ms a frame settling and 181 ms mid-collapse (33 ms is a 30 fps frame), so a collapse still runs in slow motion; next steps would be fewer composes per move (`place_body` composes the body for every try and bisection round), skipping the turn check on alternate frames, and fewer blocks awake at once. **Jenga tower rules** (owner: a tower balanced on one block never collapsed; picture of a tower standing on the middle block of its bottom layer): the example script now treats a block held **only at its middle** as *balanced*, which is unstable: it goes over the edge of the block under it (`balance_reach`), toward the side that lost support last (a hash of its height if unknown, so a layer goes the same way). Going over is a **tip** (about an edge, in steps of at most 3 degrees a frame so the next look sees it touch what it lands on) when nothing is on top of the block, and a **slide** out from under its load along its length otherwise (a tip lifts one side, and that side pushed up into the load and then the body, being inside a solid, fell through everything). A block that lands where the probes see nothing (an edge under its very tip, the corner of a tilted block) goes over that edge. Blocks don't turn in the air. Checked on the emulator with the owner's project and the outer two blocks of the bottom layer pulled: the layer above slides out, everything above it comes down, blocks scatter and some fall off the table; a few blocks end up tilted into the table's edge (a tip is placed, not collision-tested). **Broad phase (owner said the Jenga physics were slow):** measured first with a 50-block solid tower in that test: a probe cost 4 ms and a move 1.7 ms, because each call brought up to date and tested *every* solid. Now `gs_move_and_collide` and `gs_probe_solid` keep a compact list of solid nodes (`solid_nodes`) and only refresh/test the solids near them (a cheap per-axis box test on last frame's transforms, `node_near`; a probe takes solids as placed at the start of the frame and tests points against boxes directly, `point_in_box`, GJK only for other shapes). Now: probe 0.46 ms far / 0.67 ms over the tower, move in the air 0.53 ms, resting on the tower 1.55 ms. **Lessons:** the ARM9 has no fast 64-bit multiply or square root (a first culling test using them cost as much as it saved: keep such tests to 32-bit multiplies and per-axis compares), and its data cache is 4 KB (touch as little per node as possible). What is left is mostly a per-solid scan (~0.4 ms for 58 solids) and the 0.09 ms `compose_node` of the body itself. A **body** is a node with collision shapes under it; the solid shapes it can hit are the visible `solid` ones not under it.
  The checker errors (naming the node) when the script's node has no shape under it. **Runtime** (`gs_collision.c`): per-axis (Y, X, Z) moves in steps of at most 0.25
  units, a blocked step is bisected 6 times and pulled back by a 0.01 skin; a body already inside a solid may move **up**, or make any move that ends clear, but a move down or sideways that would stay inside is **refused** (it used to move freely; that let a Jenga block that a tilt had pushed a little way into the table fall straight through a 12-unit-thick table). **Example:**
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
  is a hypothesis that stopped the flake, not a proven cause; OGG never exercised; no signals, arrays, classes, vectors as values (except copying one node's `position`/`rotation`/`scale` to another's: `$Block.position = $Touch.position`, checked in `checkAssign`, three assignments in `script-codegen.ts`; not run on the emulator),
  runtime node creation, or in-editor run; no Scene-tree marker for nodes with scripts; 2D projects can write scripts, but the 2D ROM ignores them (warning `two-d-scripts-not-built`).
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

## Known test-environment failures (not caused by the code; don't chase them)
- `translate-scene-3d.test.ts` "the runtime's fallback scene": on this Windows checkout (`core.autocrlf=true`) the committed
  `runtime/source/scene_data.c` is CRLF in the working tree while the generator writes LF, so the byte comparison fails. Everything else passes
  (`pnpm test`: 722 tests as of the sprite work).
- `pnpm -r typecheck` reports errors in `apps/desktop` about `ChildProcess.on/once` in the compiler's `node-adapters.ts` and `node-emulator.ts`
  (the desktop app typechecks those sources with a different `@types/node`); the compiler's own typecheck passes.
- `tests/prototypes/e2e` needs `npm install` there once (puppeteer-core) before its scripts run; see its README.

## Not built yet (known gaps — see `requirements/` tickets, above, for detail)
- Project file I/O, the startup view, and project-mode locking all work.
  Recent projects and the unsaved-changes guard work too. Still
  missing: automated JSON Schema generation (both schemas are
  hand-authored), the Project menu's Open Recent, the rest of 2D (sprites, scripts, sound, collision, a
  scrolling camera and tile maps all compile and run in a standalone 2D ROM now; an AnimationPlayer and
  switching scenes still do not -- see `scene-designer/EPIC.full-2d-games.md`; Export ROM and Play are built for both
  modes; models, textures, sounds and sprite images can be imported), and CI for any of the tests (`pnpm test` and
  `pnpm test:rom` run locally; the editor E2E prototypes are in `tests/prototypes/`). All tracked
  as real tickets rather than a prose list — this section intentionally
  stays short so it doesn't drift out of sync with them.
