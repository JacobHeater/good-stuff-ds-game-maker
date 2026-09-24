---
status: done
component: run-games-locally
related: [STORY.play-button-stub.md, SPIKE.game-runtime-approach.md, SPIKE.emulator-selection-and-launch.md, compiler/STORY.export-rom-from-project-menu.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md, debugger/TASK.real-debug-session-support.md]
---

# Story: Play builds the project and runs it in an emulator

## Context
Replaces `STORY.play-button-stub.md`, whose "Play" logs a message and does
nothing. Once the compiler can build a ROM and an emulator has been chosen
(`SPIKE.emulator-selection-and-launch.md`), the toolbar's Play button can
do what it's for: build the project as it is right now and open the result
in the emulator.

## Description
Clicking "Play" compiles the open project (including unsaved edits, exactly
as `compiler/STORY.export-rom-from-project-menu.md` does) to a ROM in a temp
location, then launches the configured emulator with it. Diagnostics and
build output go to the Output log, and if compilation fails no emulator is
started. If no emulator can be found, the Output log says so and how to
set one up. Pressing Play while a run is already going stops that run and
starts a fresh one.

## Acceptance Criteria
```gherkin
Scenario: Play builds and launches
  Given a valid 3D project and an installed emulator
  When "Play" is clicked
  Then the project is compiled to a ROM
  And the emulator opens showing it

Scenario: A failed build launches nothing
  Given a project that can't be compiled
  When "Play" is clicked
  Then the Output log shows why
  And no emulator is started

Scenario: Unsaved edits are what runs
  Given unsaved edits to the project
  When "Play" is clicked
  Then the running ROM reflects them
  And the project file is not written

Scenario: A missing emulator is explained
  Given no emulator can be found
  When "Play" is clicked
  Then the Output log says so and how to set one up
  And the ROM that was built is still available to open manually

Scenario: Play replaces the previous run
  Given a Play run is still open
  When "Play" is clicked again
  Then the old emulator is closed and a new one opened with the fresh ROM

Scenario: The editor stays usable
  While a build or an emulator run is in progress
  Then the editor can still be used
```

## Notes
- **Built and verified against the real app** (`tests/prototypes/e2e/play.mjs`, 6 checks, real
  compiler, toolchain and melonDS; `pnpm test` has 13 more on `PlaySession` and the emulator
  locator using fakes): a project that can't compile logs why and starts nothing; a valid project
  opens melonDS with a real `.nds` from a temp folder (`%TEMP%\gsds-play`); unsaved edits are what
  runs (the ROM differs from the previous run's) and the project file's bytes and modified time
  are unchanged; a second Play closes the old emulator, opens a new one, and deletes the old ROM;
  Play works again after the user closes the emulator by hand; a missing emulator is explained
  and the built ROM's path is in the message and the file exists.
- Behavior choices: a new run replaces the old one **only after the new ROM has built**, so a
  build that fails leaves the running game alone. While building, the button reads "Building..."
  and is disabled (the main process also refuses a second build). Once started, the emulator is
  independent of the editor; Play doesn't wait for the game to end. Quitting the editor closes
  the game it started (`before-quit`). **Verified by emitting the event, not by a real quit**,
  since a real quit with unsaved edits is held by the unsaved-changes guard.
- **Finding the emulator:** `GSDS_MELONDS_PATH` (if set but wrong, that's reported, never
  silently replaced by another install), then the winget package folder, then Program Files.
  There is no settings screen yet, so the environment variable is the "set one up" route; a
  Project Settings / preferences entry would be the natural home for it later.
- Not verified: launching with a path that contains spaces on a machine where melonDS lives
  under Program Files (the arguments are passed as an array, so it should hold, but this
  machine's install is the winget one); macOS and Linux (the toolchain locator is Windows-only too).
- Supersedes the "no backend wired up yet" message; when this ships,
  `STORY.play-button-stub.md` becomes historical and gets a superseded note
  (same treatment as the FileSystem dock stub).
- What the Debugger tab can show follows from this being an external
  process; that's `debugger/TASK.real-debug-session-support.md`'s problem
  and stays out of scope here.
