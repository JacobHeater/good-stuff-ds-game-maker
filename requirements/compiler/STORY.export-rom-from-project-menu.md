---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, TASK.rom-build-driver.md, STORY.compile-diagnostics-for-unsupported-content.md, STORY.compile-3d-scene-to-nds-rom.md, project-menu/EPIC.project-menu.md, project-menu/STORY.unsaved-changes-guard.md, debugger/STORY.output-log-tab.md]
---

# Story: Export a ROM from the Project menu

## Context
The build driver and the command-line entry make the compiler usable from
a terminal; this puts it in front of the person using the editor. The
Project menu is the right home: exporting acts on the project as a whole,
which is the ownership rule in `project-menu/EPIC.project-menu.md` (that
Epic lists "Export" as an entry that waits on this component).

## Description
A **"Export ROM..."** entry in the Project menu, below Save and above Close,
enabled whenever a project is open. Choosing it:
1. Checks the project first. A project with a compile error (no camera, 2D,
   over budget...) is reported in the Output log **without asking for a
   location**, so it never prompts for a place to put a ROM that can't exist.
2. Asks where to save the `.nds` (a native save dialog, defaulting to the
   project's name next to the project file).
3. Compiles the project *as it currently is in the editor*, including
   unsaved edits, since the compiler takes a `ProjectSnapshot` (built from
   the editor's current scene, the same way Save builds one), and
   compilation itself never writes the project file.
4. Runs diagnostics, then the build, and reports progress and the outcome in
   the Output log: each diagnostic, then "Exported ROM to <path>" or the
   failure and its reason.

The work happens in the Electron main process (like every other file and
process operation), not the renderer; the app never blocks while it runs.

## Acceptance Criteria
```gherkin
Scenario: Export ROM is in the Project menu
  Given a project is open
  When the Project menu is opened
  Then "Export ROM..." is offered, after the Save entries and before Close Project
  And it is offered in no other menu

Scenario: Exporting writes a ROM
  Given a valid 3D project
  When "Export ROM..." is chosen and a location is picked
  Then a .nds file is written there
  And the Output log says where

Scenario: Unsaved edits are included, and nothing is saved
  Given a project with unsaved edits
  When it is exported
  Then the ROM reflects those edits
  And the project file on disk is unchanged
  And the project still shows as having unsaved changes

Scenario: Cancelling the dialog does nothing
  When the location dialog is cancelled
  Then no build starts and nothing is written

Scenario: Diagnostics are shown in the Output log
  Given a project with an unsupported node
  When it is exported
  Then the warning or error is shown in the Output log, naming the node
  And an error prevents any build
  And no location is asked for

Scenario: A missing toolchain is explained
  Given devkitPro is not installed
  When "Export ROM..." is chosen
  Then the Output log says the toolchain is missing and what to install

Scenario: The editor stays responsive
  While a build runs
  Then the editor can still be used
  And a second export can't be started until the first finishes

Scenario: A 2D project says so
  Given a 2D project
  When it is exported
  Then the Output log says 2D export isn't supported yet
```

## Notes
- **Built and verified against the real app** (`tests/prototypes/e2e/export-rom.mjs`,
  8 checks, run three times): the menu position, an error project (no
  location asked), cancelling, a real `.nds` written with a valid header and the
  dialog starting in the project's folder, unsaved edits appearing in the ROM
  (two exports differ) while the project file's bytes and modified time stay
  unchanged and it still shows as unsaved, the entry showing "Exporting ROM..." and
  disabled during a build, and a 2D project. A ROM exported this way was also run
  in melonDS and draws the scene. **Not click-tested:** the missing-toolchain scenario
  runs only against fakes (`rom-builder.test.ts`, `compile-report.test.ts`), because
  the locator always finds this machine's install; and the *real* native save
  dialog, which the test stubs like every other native dialog.
- The main process enforces "one export at a time" (a second call returns an
  error line); the menu disabling the entry is the visible half of it.
- The compiler's C runtime is found at `packages/compiler/runtime` when running
  from the repo, and in the app's resources (`compiler-runtime`, via
  `extraResources` in `electron-builder.yml`) when packaged. **The packaged
  path has not been built or tried.**
- A freshly added camera and mesh both sit at the origin, so the camera is
  inside the mesh and the ROM shows a flat grey screen. That's correct
  behavior and a real usability trap; see
  `scene-designer/STORY.camera-light-and-material-properties.md`.
- The unsaved-changes guard is not involved: exporting doesn't replace or
  close anything.
- After it succeeds, "reveal in folder" or "run in emulator" are natural
  follow-ups; the latter is `run-games-locally/STORY.play-runs-rom-in-emulator.md`.
- The shared `GoodStuffWindowApi` gains an `export` operation, defined in
  `@goodstuff/core` with the rest so the preload and renderer can't drift.
