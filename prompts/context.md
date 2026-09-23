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
  deps; not yet consumed by `apps/desktop` (see below).

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

- **Workspace tabs**: `2D`, `3D`, `Script`, `Game`. Only 2D and 3D render
  real content so far (`Script`/`Game` are placeholder tabs, not yet built).
- **Scene menu** (`packages/ui/src/editor/layout/SceneMenu.tsx`) is a real
  dropdown: New Scene, Add 2D Node / Add 3D Node (full kind lists with
  icons), Duplicate/Delete Node (disabled on the scene root), and Save
  Scene / Save Scene As / Close Scene (currently stubbed to the Output log —
  there's no project file backend yet). The other menu bar items (Project,
  Debug, Editor, Help) are still inert placeholders.
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
- Tree helpers: `flattenSceneTree`, `findSceneNode`, `updateSceneNode`,
  `removeSceneNode`, `duplicateSceneNode` (fresh ids throughout),
  `insertNodeAfterSibling`, `uniqueNodeName`, `createBlankSceneTree` (New
  Scene), `createSampleSceneTree` (starter content incl. a `World3D`
  subtree: camera, sun light, ground plane, cube).
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
`SceneMenu` wires these in and gained a new **"Open Project..."**
item (there was previously no UI path to Open at all).
`FileSystemPanel` now calls `listDirectory` against the open project's
folder instead of a hardcoded list, with no-project/loading/error
states.

**Temporary stand-in**: since project-mode commitment
(`scene-designer/TASK.lock-workspace-to-project-mode.md`) and the real
New Project flow aren't built yet, a never-saved project defaults to
`mode: "2D"` on first save. Replace this once
`startup-view/STORY.new-project-flow-with-mode-commitment.md` supplies
a real chosen mode.

**Verification limits**: typecheck/build are clean, the app launches
without error, and the underlying save→load/error-handling logic was
proven by the smoke test mentioned above. The native OS save/open
dialogs themselves were **not** click-tested by the agent — that
needs a human running the app.

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

**Major forward decision — projects permanently commit to 2D or 3D at
creation.** This is a deliberate constraint, not a gap: a new project
must choose "2D" or "3D" mode up front (`startup-view/STORY.new-project-flow-with-mode-commitment.md`),
that choice is stored as part of the project and can **never** be
changed afterward — converting means starting a new project from
scratch. Once built, `scene-designer` will only expose the matching
viewport tab (`scene-designer/TASK.lock-workspace-to-project-mode.md`: a 2D project
never shows a "3D" tab and vice versa) and the Scene menu will only
offer that mode's node kinds. **None of this is implemented yet** —
today's app still freely switches between 2D/3D tabs and offers both
node-kind lists unconditionally (that's `createSampleSceneTree()`
mixing both for demo purposes). Don't build a feature that assumes a
project can hold both 2D and 3D content, and don't let the free
tab-switching in `STORY.workspace-tabs-and-screen-filter.md` mislead
you into thinking that's the target behavior — it's documented there
as "what's built today," explicitly flagged as scheduled to be
replaced.

**Current coverage** (see each folder for the authoritative, detailed
version — this is a summary, not a substitute):
- `scene-designer` — deepest coverage: an Epic, four retroactive
  Stories (2D viewport, 3D viewport — **read
  `STORY.3d-editing-viewport-native-resolution.md` before touching 3D
  viewport resolution/sizing again**, its three-iteration history is
  recorded there — Scene menu node CRUD, workspace tabs), and forward
  Tasks/Spike (undo/redo, asset import, and mode-locking). Real
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
  is still `proposed` — pure Electron IPC/UI wiring left, no design
  work remaining underneath it. This is the single most-depended-on
  component in the whole tree — `startup-view`, `project-list`, real
  `file-browser` behavior, `scene-designer`'s mode-lock and
  mesh-import Spike, and `audio`'s asset Task all wait on the Epic.
- `node-list`, `properties-panel` — one retroactive Story each (Scene
  Tree panel, Inspector panel), both fully built and Done.
- `debugger` — three retroactive Stories (Output tab, Debugger
  placeholder, Hardware budget report — moved here from
  `scene-designer` since it's the same `BottomPanel` dock) plus a
  forward Task blocked on a real runtime existing.
- `run-games-locally` — retroactive Story for the Play-button stub,
  plus a Spike on how "running a game" should actually work
  (in-editor interpreted preview vs. compiled ROM + emulator —
  unresolved, tightly coupled to `scripting`'s language Spike).
- `scripting` — nothing built; an Epic plus a Spike on language/
  execution approach (also unresolved, same coupling as above).
- `audio` — retroactive Story for the modeled-but-silent
  `AudioStreamPlayer` node/budget counting, plus a forward Task for
  real playback (blocked on asset-import and runtime decisions).
- `compiler` — nothing built; an Epic plus a Spike on toolchain choice
  (devkitPro/libnds vs. custom vs. explicitly deferring this entire
  epic — deferring is a legitimate spike outcome).
- `startup-view` — nothing built; an Epic plus three forward Stories
  (landing screen, New Project flow — this is where the 2D/3D mode
  commitment rule above is fully specified — Open Existing Project
  flow), all blocked on `persistence/TASK.persist-scene-to-project-file.md`
  landing first (no saved project format yet to launch into or list).
- `project-list` — nothing built; an Epic only, same blocking
  dependency, now also noting that listed projects should show their
  committed mode.

## Not built yet (known gaps — see `requirements/` tickets, above, for detail)
- Project file I/O now works (see "Save/Save As/Open/Close" above).
  Still missing: automated JSON Schema generation (schema is
  hand-authored), project-mode commitment/locking, undo/redo, an asset
  pipeline, real scripting/runtime/compiler, and a project
  picker/launch screen. All tracked as real tickets rather than a
  prose list — this section intentionally stays short so it doesn't
  drift out of sync with them.
