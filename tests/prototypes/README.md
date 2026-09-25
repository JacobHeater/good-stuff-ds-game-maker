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

## `e2e/mesh-primitive.mjs` — choosing a mesh's primitive (6 checks)

Drives the real UI: the Inspector's Mesh select, the viewport redrawing, the Hardware tab's
triangle count, save / close / reopen. It prints `SAVED <path>` for the project it built (one of
each primitive), which the emulator test can then compile and compare:

```sh
pnpm build && node tests/prototypes/e2e/mesh-primitive.mjs
GSDS_ROM_PROJECT=<the SAVED path> pnpm test:rom
```

## `e2e/import-obj.mjs` — importing an .obj model (10 checks)

Drives the real UI and stubs only the file dialogs: Import Model in the Scene menu (not in the Project menu, not
in 2D), cancel, five bad files (each refused with a reason, adding nothing), the good one
(`models/house.obj`, hand-written, 14 triangles), reuse through the Inspector's Mesh select, save (the model
is embedded once), close and reopen, a real Export ROM, and unused models being dropped on save. It prints
`SAVED <path>` for a project of two houses and a cube, which the emulator test can compile and compare:

```sh
pnpm build && node tests/prototypes/e2e/import-obj.mjs
GSDS_ROM_PROJECT=<the SAVED path> pnpm test:rom
```

## `e2e/transform-tools.mjs` — Select / Move / Rotate / Scale (10 checks)

The one script here that uses **real mouse input on the 3D viewport**. It screenshots the canvas with and
without a gizmo, finds the red / green / blue handles by color, presses on one, drags, and reads the Inspector
(pixels are decoded in Node with `pngjs` borrowed from the compiler package). It checks that a drag changes
only its own axis, keeps the selection, doesn't orbit the camera, that a 2D project has no tools, that Q/W/E/R
switch tools, that a camera gets no scale gizmo, and that a nested node moves in its parent's space. Saves
`transform-tools-move.png` (git-ignored) so you can look at the gizmo.

```sh
pnpm build && node tests/prototypes/e2e/transform-tools.mjs
```

## `e2e/undo-redo.mjs` — Ctrl+Z / Ctrl+Shift+Z (13 checks)

Real keyboard chords, real typing into an Inspector field, and real gizmo drags (it borrows the color-finding
trick from `transform-tools.mjs`). Covers the Scene menu entries and their labels, undo/redo of add, delete, typing,
drags and a model import (checking the saved file gains and loses the model), a new edit clearing redo, "undo back
to the saved state reads as clean", history surviving a save, being ignored behind the unsaved-changes prompt and
on the startup view, and not crossing projects.

```sh
pnpm build && node tests/prototypes/e2e/undo-redo.mjs
```

## `e2e/texture-mesh.mjs` — PNG textures on meshes (13 checks)

Writes real PNG files (a 16 x 16 four-quadrant picture, a 32 x 32 checker, a 100 x 60 image, a 1024 x 1024 image, one
with partly transparent pixels, a text file named `.png`) and imports them through the real UI. It reads the colors
the 3D viewport actually draws from a screenshot of its canvas (the viewport's axes lines are pure red/green/blue,
so it compares with the untextured scene, with nothing selected so the selection tint doesn't interfere), checks the
Hardware tab's texture memory, the saved file's texels corner by corner, close/reopen, undo/redo, models with and
without UVs (`quad-uv.obj` is written by the script), and a real Export ROM.

```sh
pnpm build && node tests/prototypes/e2e/texture-mesh.mjs
```

## `e2e/lighting-parity.mjs` — the editor's lighting and the intensity slider (9 checks)

Builds a flat grey plane and a directional light through the real UI, reads the brightness the viewport actually draws from a
screenshot of its canvas, and compares it with the DS lighting formula (restated in the script, so it checks the app against numbers
and not against its own code). The ROM test `lighting.rom.test.ts` holds a real ROM to the same formula. Covers no-light (unlit, not
black), a new light's default rotation, the slider only on directional lights, the formula at 0/45/60/90 degrees (255/205/164/66),
scale not changing the lighting, the slider from the keyboard and a real mouse drag (one undo step), save/reopen, and the
direction arrow turning with the light.

```sh
pnpm build && node tests/prototypes/e2e/lighting-parity.mjs
```

## `e2e/sound-player.mjs` — importing sound and the audio player (19 checks with an MP3, 18 without)

Writes real WAV files and imports them through the real UI, then **measures the real audio**: while the Inspector's preview
plays, the loudness of the editor's own audio output is read from Windows' per-application peak meter
(`tools/ds-toolchain/measure-melonds-audio.ps1 -RootPid`), so volume (50% reads exactly half), loop, pitch (2x lasts 0.75 s, 0.5x
3 s, for a 1.5 s sound; raising it mid-sound or switching Loop off mid-loop takes effect at once), stopping by itself and stopping when another node is selected are checked by what comes out, not by what the
UI says. Also covers the Inspector's fields on an `AudioStreamPlayer` only, cancelling, a file that isn't audio and a sound too long even at 8 kHz (refused with reasons), a 33 s sound over the 2 MB budget (resampled to fit, undoable), Inspector import (assigns) vs Scene > Import Sound... (new player), stereo 44.1 kHz becoming mono
32 kHz with the log saying so, the position bar, a real mouse drag of the volume slider as one undo step, undo/redo of an import,
saving (a shared sound once, unused ones dropped, mono 16-bit), close/reopen, and finally **Export ROM from the UI and run it in
melonDS with the same meter**: only the Autoplay player sounds, at 40% volume and 1.5x pitch, as authored.

```sh
pnpm build && node tests/prototypes/e2e/sound-player.mjs
GSDS_TEST_MP3="C:\path	ony.mp3" node tests/prototypes/e2e/sound-player.mjs   # also imports a real MP3
```

Needs the toolchain, melonDS and a sound output device (the meter reads the default one), and about 75 s. No MP3 or OGG
file is kept in the repo, so MP3 is only exercised when `GSDS_TEST_MP3` is set (verified once with a 44.1 kHz stereo MP3); OGG has
not been exercised at all (its header sniffing is unit-tested with a hand-built header).

## `e2e/script-editor.mjs` — the Script tab and attaching scripts (14 checks)

Drives the real app with real typing, pasting and shortcuts: New Script and the stubs, Enter/Tab indentation, mistakes underlined
and listed with line:column (hover and click-to-jump), diagnostics following the scene (a `$Node` that starts and stops existing),
attaching from the Inspector, per-node member checks, rename, the Inspector's New Script and Edit, undo inside and outside the code
editor, delete with its confirmation and one-step undo, save and reopen (an unattached script is kept), and Export ROM refused for a
script error (script, line, column) and then built once fixed.

```sh
pnpm build && node tests/prototypes/e2e/script-editor.mjs      # prints "SAVED <path>" for the project it built
GSDS_SCRIPT_ROM_PROJECT=<path> pnpm test:rom                    # compiles it, runs it in melonDS, compares with the static equivalent
```

Needs the toolchain (about 30 s). The second command needs melonDS; it checks that the script's `position` assignment put the cube
where the equivalent static scene has it (IoU 0.996 when last run) and not where the unscripted scene has it.

## `e2e/collision-shapes.mjs` — collision shapes and naming nodes (9 checks)

Adds a `CollisionShape3D` and edits it through the Inspector with real typing (the fields following the shape, `1.5` typed without being clamped half way,
undo and redo as one step per number and one per shape change), renames nodes (Scene tree, undo, an empty name refused, spaces trimmed), reads the 3D viewport
from screenshots (the wireframe in the shape color, in blue and larger when selected, gone when hidden), clicks the shape in the viewport to select it, saves,
closes and reopens; then builds a small game through the UI (a player and a wall each with a shape, a hidden flag, a camera, a light), writes the script in the
Script tab (an `overlaps()` on a mesh is an error that says what to do), and exports: the shapes are warned about until the script is attached.

```sh
pnpm build && node tests/prototypes/e2e/collision-shapes.mjs      # prints "SAVED <path>" for the game it built
GSDS_COLLISION_ROM_PROJECT=<path> pnpm test:rom                    # compiles it, runs it in melonDS with the D-pad held, checks the flag
```

Needs the toolchain (about 45 s). The second command needs melonDS: with nothing pressed the flag is hidden (silhouette overlap 0.990 with the right picture,
0.631 with the wrong), and with Right held the player walks into the wall and the flag appears (0.994 against 0.565).

## `scripts/` — example scripts for trying the editor

Scripts in the project's own language, ready to paste into the Script tab and attach to a node. They compile in a test (`scripts.test.ts`) so they stay valid.

- `dpad-rotate.gsscript`: the D-pad turns the model (Left/Right about the vertical axis, Up/Down tip it), A resets it.
- `move-8way.gsscript`: simple 8-way movement with gravity and a jump for testing 3D games: the D-pad walks along X and Z (Up = -Z, away from the camera), diagonals are
  normalized so they are no faster, B runs, A jumps (once, from the ground), and the player turns to face its walking direction (`turn`, `face_offset`). It moves with
  `move_and_collide`, so like `player-jump.gsscript` it needs a collision shape under the player and solid shapes for the ground. **Its `move-8way.rom.test.ts` was written for
  the earlier flat version (no gravity, no shapes) and has not been updated or rerun for this one.**
- `player-jump.gsscript`: a simple platformer player for testing games: Left/Right walk, A jumps (once, from the ground), gravity pulls it down, and **solid collision shapes are
  the ground** (`move_and_collide`: it lands on floors and steps, is stopped by walls, bumps its head). Set-up notes are at the top of the file. Its physics is checked frame by
  frame on the DS in `player-script.rom.test.ts` (walking speed, jump height and length, no double jump, landing on a step, walls, a low ceiling).

## `e2e/script-autocomplete.mjs` — auto-complete in the script editor (9 checks)

Real key presses in the Script tab of a project with a mesh, a sound player and an AnimationPlayer: the pop-up after `$` (nodes and their kinds), after a dot (what that kind of node has),
inside `Input.is_button_down("` (the buttons), the script's own variable and `delta`, nothing in comments or plain strings, Ctrl+Space, Escape, Tab and Enter, and a `func _process(delta):` template.
The logic itself is unit-tested in `packages/core/src/script/completion.test.ts`.

```sh
pnpm build && node tests/prototypes/e2e/script-autocomplete.mjs
```

## `e2e/two-d-screen.mjs` — choosing the 2D screen of a 3D project (8 checks)

Real clicks and typing: New Project asks for the 2D screen only for 3D (bottom by default), a project with 2D on top opens with 3D on the bottom screen, the Add Node menu's 2D section, each
node's screen in the Scene tree (a Label put under the root although a mesh was selected), the 2D screen's own editor with the Label as a marker, the toolbar's swap with undo and redo,
save / close / reopen, and Export ROM with its "2D nodes aren't drawn yet" warning. It prints `SAVED <path>`; `GSDS_TWO_D_ROM_PROJECT=<path> pnpm test:rom` then runs it in melonDS and checks
the cube is on the bottom screen.

```sh
pnpm build && node tests/prototypes/e2e/two-d-screen.mjs
```

## `e2e/platformer.mjs` — solid shapes as ground (4 checks)

The **Solid** checkbox on a collision shape (off for a new one, undoable, and the shape drawn in a warm color instead of the plain one, read from screenshots); then a small
platformer authored through the UI (a player with a body shape, a solid floor and a solid wall each with a visible mesh, a camera, a light), the example player script
(`scripts/player-jump.gsscript`) pasted into the Script tab with no problems (and an error naming the node when attached to one with no shape), and an export that warns about nothing.

```sh
pnpm build && node tests/prototypes/e2e/platformer.mjs        # prints "SAVED <path>"
GSDS_PLATFORMER_ROM_PROJECT=<path> pnpm test:rom               # runs it in melonDS: the player falls onto the floor and stands; with Right held it stops at the wall
```

## `e2e/animation.mjs` — the AnimationPlayer (10 checks)

Adds an AnimationPlayer and makes two animations through the Animation panel with real clicks and typing (New Animation, renaming, a position track and keys taken from the cube's
values, a key's time edited, a rotation track), reads the 3D viewport from screenshots while the playhead is at 0, 1 and 2 s (the cube is left, middle and right, and its own
position never changes), plays the preview to its end, undoes and redoes, checks a script's `play("nope")` error, deletes an animated node and undoes it, saves, closes and reopens,
and exports.

```sh
pnpm build && node tests/prototypes/e2e/animation.mjs          # prints "SAVED <path>"
GSDS_ANIMATION_ROM_PROJECT=<path> pnpm test:rom                # runs it in melonDS: the autoplay animation slides the cube; tapping A plays the script's tilt
```

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
