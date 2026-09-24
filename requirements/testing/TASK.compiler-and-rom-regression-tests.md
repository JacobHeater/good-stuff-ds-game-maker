---
status: in-progress
component: testing
related: [EPIC.automated-testing.md, TASK.persistence-contract-tests.md, compiler/EPIC.compile-and-export-nds-rom.md, compiler/TASK.ds-scene-intermediate-representation.md, compiler/TASK.rom-build-driver.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, run-games-locally/SPIKE.emulator-selection-and-launch.md]
---

# Task: Regression tests for the compiler and the ROMs it builds

## Context
The compiler's output is the first thing in this project that can be wrong
in a way nobody notices by clicking around: a matrix in the wrong order
gives a ROM that builds, boots and shows a cube in the wrong place. Three
kinds of check answer three different questions, and they have very
different costs, so they're separate layers:

1. **Translation tests** (fast, no toolchain): is the scene description
   right? `TASK.ds-scene-intermediate-representation.md` is a pure function,
   so it's held to ordinary unit tests with known projects and exact expected
   output, run everywhere.
2. **Build tests** (needs devkitPro): does a known project build to a
   `.nds`? Skipped, visibly, when the toolchain isn't installed, and run
   where it is. The build driver's own logic (missing toolchain, failed
   build) is tested with fakes and needs no toolchain.
3. **Emulator tests** (needs the toolchain and an emulator): does the built
   ROM boot and draw what it should? How much can be asserted depends on
   what `run-games-locally/SPIKE.emulator-selection-and-launch.md` finds out
   about capturing a run without a person.

## Description
- A small set of **fixture projects** (committed `.gsds` files): one cube; one
  of each primitive; nested `Node3D` parents with mixed transforms; a hidden
  branch; a project with each unsupported feature. Each is used by every layer.
- **Translation tests** against expected scene descriptions for every fixture,
  including rotation order checked against three.js's own result, fixed-point
  round trips, and byte-identical repeat output.
- **Diagnostics tests** for every row of the table in
  `compiler/STORY.compile-diagnostics-for-unsupported-content.md`.
- **Build tests** that build the fixtures, guarded on the toolchain.
- **Emulator tests**, to the extent the emulator allows. Candidate assertions,
  from cheapest to most demanding: the ROM boots and runs for N frames
  without crashing; a captured frame isn't blank; a captured frame's
  silhouette matches a reference render of the same scene and camera,
  produced with three.js at 256×192, within a tolerance. The reference-render
  comparison is the strongest and also the only one that would have caught a
  wrong matrix order; it's worth attempting if capture is possible.
- Wired into the suite from `TASK.persistence-contract-tests.md`, with the
  slow layers opt-in locally and required in CI once CI has a toolchain.

## Acceptance Criteria
```gherkin
Scenario: Translation is tested on every fixture without a toolchain
  Given a machine with no devkitPro installed
  When the translation tests run
  Then each fixture's scene description is compared with its expected output

Scenario: Every diagnostic is covered
  Then each error and warning in the diagnostics table has a test that triggers it

Scenario: Build tests skip visibly, not silently
  Given devkitPro is not installed
  When the suite runs
  Then the build and emulator tests are reported as skipped, with the reason
  And the run does not report success as if they had passed

Scenario: A known project builds
  Given devkitPro is installed
  When each fixture is compiled
  Then a .nds file is produced

Scenario: A broken matrix is caught
  Given the compiler's rotation or composition order is deliberately broken
  Then at least one test fails

Scenario: The ROM's output is checked, as far as the emulator allows
  Given an emulator and a capture method were found by the emulator Spike
  When a fixture ROM is run
  Then the captured frame is compared with the reference render of the same scene
  Or, if capture is not possible, the ROM is shown to boot and run without crashing

Scenario: Fixtures are the single source of truth
  Then the translation, build and emulator tests all read the same fixture projects
```

## Notes
**Implemented, so `in-progress`** (the remaining gaps are listed at the end).
- **Runner:** `vitest` 2, at the repo root (`pnpm test`). vitest 5 was tried first
  and won't start against the repo's Vite 5. The fast tests are `*.test.ts`; the
  emulator tests are `*.rom.test.ts`, excluded from `pnpm test` and run by
  `pnpm test:rom` (`vitest.rom.config.ts`, sequential, long timeouts), because they
  open emulator windows and need a desktop.
- **Fixtures:** `packages/compiler/src/fixtures.ts` (cube, one of each primitive,
  nested with a hidden branch, bottom screen, and a 169-cube full-budget scene).
  Every layer reads them.
- **Translation and diagnostics tests** (no toolchain): 27 in
  `translate-scene-3d.test.ts` covering every row of the diagnostics table,
  hidden branches, parent composition, lights, determinism and data-only output;
  20 in `matrix.test.ts` checking composition, inverse and look-at against three.js
  itself; 28 in `packages/core` for the shared geometry. `pnpm test` is 96 tests.
- **Build tests:** the build driver's every outcome is tested with fakes
  (`rom-builder.test.ts`, 20 tests, no devkitPro needed). Real builds happen in the
  emulator tests. They are *skipped* (not silently passed) when the toolchain isn't
  found: `describe.skipIf`.
- **Emulator tests:** `packages/compiler/src/testing/` builds each fixture into a
  ROM, runs it in melonDS, captures the top screen, and compares its silhouette
  with a three.js render of the same project (`reference-render.ts`,
  `emulator-capture.ts`), intersection-over-union at least 0.85. Covers the four
  primitives, nested transforms and a hidden branch, the bottom screen, the full
  triangle budget, a 30 FPS build, and, when `GSDS_ROM_PROJECT` points at one, a
  **project authored through the real editor UI** (`tests/prototypes/e2e/ui-to-rom.mjs`
  saves one; it scores 0.91). Two sensitivity checks prove the comparison can fail.
- **"A broken matrix is caught":** demonstrated by mutation. Swapping the rotation
  order to `Rz·Ry·Rx` fails six tests; the change was reverted.
- **Not done:** the ROM tests aren't in CI (they need a desktop and melonDS);
  lighting isn't asserted (silhouettes ignore shading); 30 FPS pacing can't be
  measured through melonDS's title; one camera isn't moved between two ROMs to prove
  the view changes; and the "the check can fail" cases cover two mutations, not a
  systematic set.

- Reference renders compare *shape and placement*, not lighting or color:
  the DS's lighting model is coarser than three.js's, and every mesh starts
  the same grey. Use silhouettes.
- Don't delete the hello-cube ROM the Spike produces; it's the smallest
  possible emulator test and the baseline for "the toolchain works".
