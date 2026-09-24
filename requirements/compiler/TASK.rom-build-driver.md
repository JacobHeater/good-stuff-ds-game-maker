---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, SPIKE.compiler-toolchain-selection.md, TASK.ds-scene-intermediate-representation.md, TASK.ds-runtime-c-template.md, STORY.compile-3d-scene-to-nds-rom.md, STORY.export-rom-from-project-menu.md, persistence/EPIC.project-persistence.md]
---

# Task: The ROM build driver

## Context
Steps 3 and 4 of the pipeline: take a translated scene and the C runtime,
run the DS toolchain, and hand back a `.nds`. It's the only part of the
compiler that touches the outside world (processes, the file system, an
installed toolchain), so it's built the way persistence is: small ports,
a Node implementation, and a fake one, so everything upstream and every
caller can be tested without devkitPro present.

## Description
In `@goodstuff/compiler`:
- **`ToolchainLocator`** (port): finds the toolchain and reports what it
  found. Node implementation checks the `DEVKITPRO` environment variable
  first, then the usual install locations (on Windows, `C:\devkitPro`). It
  reports the toolchain root, its `make`, and the compiler version, or
  precisely what is missing.
- **`BuildRunner`** (port): runs a command in a directory and streams its
  output. Node implementation spawns a child process with the toolchain's
  environment set (the devkitPro tools expect `DEVKITPRO` and `DEVKITARM`,
  and on Windows their MSYS2 `make`).
- **`RomBuilder`**: given a translated scene and an output path, creates a
  clean temp build directory, copies in the runtime, writes `scene_data.c`
  and `scene_data.h`, runs the build, copies the resulting `.nds` to the
  output path, and reports success or failure. Failures are typed:
  *toolchain missing*, *build failed* (with the toolchain's own output and
  the first error line), *could not write output*. Never a bare exception.
- **A command-line entry** (`compile <project.gsds> <out.nds>`) so the
  compiler is usable and testable from a terminal, independent of the app.
  The app calls the same `RomBuilder` from the Electron main process
  (`STORY.export-rom-from-project-menu.md`).

## Acceptance Criteria
```gherkin
Scenario: A project builds to a ROM
  Given devkitPro is installed and a valid 3D project
  When the driver is run for it
  Then a .nds file exists at the requested path
  And the driver reports success and the path

Scenario: A missing toolchain is reported as such
  Given no devkitPro installation can be found
  When a build is requested
  Then it fails with a "toolchain missing" result that says what to install
    and which locations were searched
  And no build directory is left behind

Scenario: A toolchain error is reported with its output
  Given the toolchain fails to build
  Then the result is "build failed" and includes the toolchain's output
  And the first error line is surfaced separately

Scenario: Builds don't interfere with each other or the source tree
  When two builds run
  Then each uses its own temp directory
  And the checked-in runtime sources are never modified

Scenario: The toolchain is located, not assumed
  Given devkitPro at a non-default location with DEVKITPRO set
  Then the driver finds and uses it

Scenario: The driver is testable without a toolchain
  Given fake ToolchainLocator and BuildRunner implementations
  Then RomBuilder's behavior, including every failure result, is tested
    with no devkitPro installed

Scenario: The command line and the app share one implementation
  Then the command-line entry and the app's export action call the same
    RomBuilder
```

## Notes
**Implemented** in `packages/compiler/src/build/` (`ports.ts`, `node-adapters.ts`,
`rom-builder.ts`) plus `compile-project.ts` and `cli.ts`; 20 unit tests using
fake locator, runner and file system. Beyond the plan:
- `ToolchainLocator` knows two layouts (devkitPro inside a standalone MSYS2, and
  devkitPro's own installer) and honors `GSDS_MSYS2_ROOT`. A Windows `DEVKITPRO`
  variable is only a hint, because in the standalone layout it's an MSYS-side path.
- `compileProject` runs diagnostics first, so a project with an error never starts
  a build or creates a directory (tested).
- The CLI is `node packages/compiler/dist/cli.mjs compile <project> <out.nds>`
  after `pnpm --filter @goodstuff/compiler cli:build`; exit codes are 0 built,
  1 can't compile or build failed, 2 usage, 3 toolchain missing. It also has
  `scene-data` (translate only, no toolchain).
- Builds take about 4 seconds. Nothing calls this from the app yet; that's
  `STORY.export-rom-from-project-menu.md`.
- Windows is the only platform verified. The devkitPro tools there run
  under MSYS2; path forms (`C:\` vs `/c/`) are the likeliest trouble and
  belong in the Spike's recorded commands.
- Build output should be capped or streamed so a chatty toolchain doesn't
  flood the Output log.
- Caching (skip the build if the scene data is unchanged) is a possible
  later optimization, not part of this task.
