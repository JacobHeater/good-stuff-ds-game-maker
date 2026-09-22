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

## Stack decisions
- **Electron + Vite
- **Tailwind v4**
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

## Not built yet (known gaps)
- No project file I/O — Save/Save As/Close/Open are all Output-log stubs.
  `FileSystemPanel` is a static hardcoded list, not real filesystem access.
- `Script` and `Game` workspace tabs are placeholder-only.
- Project/Debug/Editor/Help menus are inert.
- No asset pipeline (sprites, audio, meshes) — only built-in mesh
  primitives (cube/sphere/plane/cylinder) exist for 3D so far.
