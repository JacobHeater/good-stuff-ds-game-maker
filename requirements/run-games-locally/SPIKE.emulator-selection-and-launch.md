---
status: done
component: run-games-locally
related: [SPIKE.game-runtime-approach.md, STORY.play-runs-rom-in-emulator.md, compiler/EPIC.compile-and-export-nds-rom.md, compiler/SPIKE.compiler-toolchain-selection.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, testing/TASK.compiler-and-rom-regression-tests.md]
---

# Spike: Which DS emulator, and how does the app run a ROM in it?

## Context
The first ROM the compiler produces has to be run somewhere to find out
whether it's right, and `SPIKE.game-runtime-approach.md` has settled that
the first "Play" is the real ROM in a real emulator. Two questions follow
that the compiler tickets depend on but don't answer: which emulator, and
how the app launches it. A third matters as much for this project's testing
discipline: whether an emulator run can be checked by a machine, so that
"the ROM looks right" isn't only ever a person looking at it.

**Decision:** melonDS. The product owner chose it, and it has now been
installed and verified to run a homebrew ROM (see Findings), so the other
candidates were not evaluated and this Spike is narrowed to launching,
discovery and machine capture with melonDS.

## Description
Compare the realistic candidates and recommend one, covering:

- **Candidates.** melonDS and DeSmuME (both open source, Windows builds
  exist) and NO$GBA (freeware, closed) are the obvious ones. A browser-
  or WASM-based emulator embedded in the editor is a possible later route
  to an in-editor Play window and is noted, not evaluated, here.
- **Launching.** Can it be started with a ROM path from the command line,
  from a child process of the Electron main process, and does it report
  when it exits?
- **What it needs.** Does it run homebrew without the user supplying
  console BIOS or firmware dumps? (If it needs them, that's a setup burden
  and a legal one, and a reason to prefer another.)
- **3D fidelity.** The first ROM is all 3D geometry; how faithful and how
  configurable is each emulator's 3D renderer, and does it have a software
  renderer that's deterministic?
- **Machine checking.** Can a run be observed without a person: a
  screenshot from the command line or a script, a headless or
  frame-dump mode, or scripting (DeSmuME has Lua scripting, for example)?
  This decides whether `testing/TASK.compiler-and-rom-regression-tests.md`
  can assert on what the ROM draws, or is limited to "it booted".
- **Licensing and distribution.** The app shouldn't bundle the emulator:
  it detects an installed one (or takes a configured path), the same
  stance as the toolchain.
- **Installing it.** How the user gets it (a download, a package manager),
  and how the app finds it.

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the candidate emulators
  Then a recommendation exists naming one, with the reasons the others were not chosen

Scenario: The chosen emulator runs a homebrew ROM
  Given the emulator is installed and a hello-cube ROM from compiler/SPIKE.compiler-toolchain-selection.md
  When the ROM is opened from the command line
  Then the cube is visible
  And whether BIOS or firmware files were needed is recorded here

Scenario: Launch and exit are observable from the app's side
  Then this ticket records the command line used, and how a parent process
    learns the emulator has exited

Scenario: Machine checking is answered either way
  Then this ticket states whether a run can be captured (screenshot or
    frame dump) without a person, and how
  Or states that it can't, and what the regression tests do instead

Scenario: Discovery is defined
  Then this ticket states how the app finds an installed emulator
    (a configured path, a search of known locations, or both)
    and what it says when none is found
```

## Findings (2026-09-23, melonDS 1.1 on Windows 11)
- **Installed** with `winget install melonDS.melonDS` (a portable zip; winget
  registers a `melonDS` command-line alias). No admin needed.
- **Runs homebrew with no BIOS or firmware files.** A libnds example ROM
  booted and ran at 60/60 FPS with nothing supplied.
- **Command-line launch works:** `melonDS.exe "<rom.nds>"` opens the ROM. It's
  a GUI application: the launching process learns it has exited from the
  process, and there's no headless mode that was tried.
- **Speed is observable:** the window title reports it, e.g.
  `[60/60] melonDS 1.1`.
- **Machine capture works, and is in use.** `pnpm test:rom` builds ROMs, runs each in
  melonDS, captures the top screen and compares it with an independent render;
  every fixture passes (see `testing/TASK.compiler-and-rom-regression-tests.md`).
  What it took to make that reliable is recorded below.
- The capture script `tools/ds-toolchain/capture-melonds.ps1` launches a
  ROM, waits, and saves a PNG of just the emulator window, with no person
  involved. It needs to be **DPI-aware**: on a scaled display a DPI-unaware
  process gets virtualized window coordinates and captures the wrong region;
  the first attempt produced a solid black image, while the desktop was in
  fact showing the ROM correctly. The rainbow triangle on the top screen was
  clearly visible in the corrected capture. This answers the machine-checking
  question in the affirmative for the regression tests.
- **Layout:** melonDS's window stacks the two screens vertically. The top
  screen is the upper half; an unused screen shows solid white.
- **Discovery** (proposed): look for `melonDS.exe` under the winget packages
  folder, then `PATH`, with a user-configurable path taking priority.

**Lessons from making capture reliable:**
- The window must be **topmost**. A background process can't always take the
  foreground, and a picture of the screen shows whatever is in front: one run
  captured the code editor instead. The script now sets the emulator topmost
  (without activating it).
- Finding the screen in the picture is fiddly. The runtime clears its 3D backdrop
  to a fixed dark blue (measured (28, 44, 85) as melonDS renders it), and the
  screen is the largest connected block of that color, eroded a few pixels and
  regrown to shave off blended pixels along the window's rounded edge. Simpler
  rules (a bounding box of "bluish" pixels; row and column density) each failed:
  colored text bleeding through at the window's edge stretched the box, and a
  scene covering most of the screen thinned the backdrop below any density
  threshold. The result is exactly 384x288 for a 256x192 screen (1.5x), found
  the same way every time.
- The detector **validates what it found** (4:3 and a plausible size) and throws
  otherwise, so a bad capture fails loudly instead of yielding a meaningless score.
- **melonDS's title reports emulator speed** (`[60/60]`), not how often the 3D
  scene is presented, so a 30 FPS scene can't be told from a 60 FPS one by it.
- Each capture takes about 10 seconds (a fixed 5-second wait for the ROM to
  settle plus launch and shutdown).

**Answered by building Play** (`STORY.play-runs-rom-in-emulator.md`): the app launches
`melonDS.exe <rom.nds>` as a child process and learns it has exited from the process's `exit` event;
closing it is `kill()` on that process (repeated launch, replace and close leave no melonDS behind:
`tests/prototypes/e2e/play.mjs` checks the process list after each step). The app finds the
emulator via `GSDS_MELONDS_PATH`, then the winget folder, then Program Files, and when there's none
the Output log says so, how to install it, and where the built ROM is.

**Still to confirm:** a screenshot-and-exit option in melonDS that would avoid the fixed
5-second wait when capturing.

## Notes
- Verify claimed capabilities by running them. Whether an emulator supports
  command-line launch or built-in homebrew boot varies by version.
