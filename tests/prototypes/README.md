# Test prototypes

Scripts written to verify features while they were being built. They work
and are kept on purpose, but they are **prototypes**: hand-rolled assertions,
no test runner, not wired into `pnpm test` or CI, and not part of the pnpm
workspace. The plan for turning them into a real suite is
`requirements/testing/`.

## `e2e/e2e.mjs` — drives the real built app (28 checks)

Launches the built Electron app, drives its renderer with `puppeteer-core`
over the Chrome DevTools Protocol, and stubs only the native OS file dialogs
(from the main-process inspector). Everything else is real: the UI, IPC, the
persistence layer, the recent-projects store, files on disk. It gives Electron
a temp `--user-data-dir`, so it never touches your real recent-projects list.

```sh
pnpm build                     # the script runs the built app in apps/desktop/out
cd tests/prototypes/e2e
npm install                    # once; puppeteer-core only, no browser download
node e2e.mjs
```

Uses ports 9333 (renderer) and 9229 (main-process inspector), so close any
other instance first. Screenshots land next to the script (git-ignored).

Covers: landing screen and empty Open panel, mode-committed New Project,
the Scene vs. Project menu split, save / save as / close / reopen, recording
and re-recording of recent projects, opening from the list, invalid files,
missing files, remove and clear, and the unsaved-changes guard (including a
real window close).

Known gotchas: `innerText` applies CSS `uppercase`; the toolbar `<select>`
adds "Top Screen" to `innerText`; the Output log persists across projects in a
session; the click that closes the window (Don't Save on a window close) races
the page disappearing, so that call is caught deliberately.

## `e2e/export-rom.mjs` — Project > Export ROM... (8 checks)

Same technique, plus the **real compiler and DS toolchain** (needs
`tools/ds-toolchain/setup-windows.ps1` done). Only the save dialog is stubbed.

```sh
pnpm build && node tests/prototypes/e2e/export-rom.mjs
```

Covers the menu position, an error project (no location asked), cancel, a real
`.nds` (header checked), unsaved edits landing in the ROM without the project file
being touched, the "Exporting ROM..." busy state, and 2D. About 40 s. To look at what
was exported, run the ROM with `tools/ds-toolchain/capture-melonds.ps1`. A new scene's
camera and mesh both sit at the origin, so an untouched export shows a flat grey screen
(the camera is inside the cube); move the camera back to see the cube.

## `e2e/play.mjs` — the toolbar's Play (6 checks)

Same technique with the real compiler and the **real melonDS**; only the save dialog is stubbed.
Kills any `melonDS.exe` before and after, so don't run it while you're using melonDS.

```sh
pnpm build && node tests/prototypes/e2e/play.mjs
```

Covers an error project (nothing launched), a real run (melonDS started with a `.nds` from the temp
folder), unsaved edits being what runs with the project file untouched, Play replacing the previous
emulator (and deleting its ROM), Play after the user closes the emulator, the game closing when the
editor quits (simulated by emitting `before-quit`), and a missing emulator
(`GSDS_MELONDS_PATH` pointing nowhere; the built ROM is kept and named). The emulator's command
line is read from the process list to see which ROM it was given. About 1 minute.

## `recents-smoke.ts` — recent-projects store (16 checks)

Runs one behavior suite against every implementation of the recent-projects
ports (in-memory, JSON over in-memory files, JSON over real disk) to check they
behave identically, plus corrupt-store and case-sensitivity cases. There is no
TypeScript runner in the repo, so bundle it with the repo's own esbuild first,
aliasing the two workspace packages to their sources (run from the repo root):

```sh
ESBUILD=node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild
$ESBUILD tests/prototypes/recents-smoke.ts --bundle --platform=node --format=esm \
  --outfile=recents-smoke.mjs --log-level=warning \
  --alias:@goodstuff/persistence=$PWD/packages/persistence/src/index.ts \
  --alias:@goodstuff/core=$PWD/packages/core/src/index.ts \
  "--banner:js=import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"
node recents-smoke.mjs && rm recents-smoke.mjs
```

(The esbuild path contains a pinned version; adjust it if the lockfile moves.)
