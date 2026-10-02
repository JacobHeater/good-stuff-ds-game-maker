---
status: done
component: scene-designer
related: [TASK.save-fps-target-in-project.md, BUG.triangle-budget-ignores-scene-instances.md, debugger/STORY.hardware-budget-report.md]
---

# Story: Targeting 30fps doubles the triangle budget

## Context
Owner's request: "when some one targets 30 fps it should double there availible triangles." The DS's ~2048-triangle
budget (`DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame`) is how much the GPU can draw in one frame's worth of
time at the hardware's native 60fps; a project that targets 30fps instead (the toolbar's 30/60 switch,
`TASK.save-fps-target-in-project.md`) gives the GPU twice as long per frame, so twice as many triangles fit in it. Both
the compiler's hard `over-triangle-budget` check and the editor's live Hardware panel gauge were using the raw 2048
constant regardless of the chosen target -- correct at 60fps, needlessly conservative at 30fps.

## Description
New `triangleBudgetFor(fpsTarget)` in core's `hardware.ts`: `approxTrianglesPerFrame * (defaultFpsTarget / fpsTarget)`,
so 60fps gives the plain 2048 and 30fps gives 4096. Both places that used the raw constant now go through it:
- `translate-scene-3d.ts`'s `over-triangle-budget` check uses `triangleBudgetFor(options.fpsTarget ?? 60)` (the fps
  target is already an option here, just unused for this check until now).
- `computeSceneBudget` (core `budget.ts`) gained an `fpsTarget` parameter (defaults to 60, like everywhere else this
  value isn't yet persisted on the project -- `TASK.save-fps-target-in-project.md` is the separate, still-proposed task
  for that); `BottomPanel.tsx`'s live Hardware tab now passes `state.fpsTarget` through, so the gauge and the
  used/limit numbers shown there already reflect the project's chosen target. The static "Fixed hardware ceiling" list
  further down (a general hardware-facts reference, not a live reading) still shows the plain 60fps number, with a note
  that the gauge above it is the one that scales.

## Notes (built and verified)
- Unit tests: `core/src/hardware.test.ts` (new: `triangleBudgetFor(60)` is the plain constant, `triangleBudgetFor(30)` is
  double it), `core/src/budget.test.ts` (new: `computeSceneBudget`'s limit doubles at 30fps, defaults to 60fps's limit
  with no target given), `compiler/src/translate-scene-3d.test.ts` (new: a scene over budget at 60fps compiles cleanly
  at `{ fpsTarget: 30 }`). Full fast suite (1194 tests) and typecheck (core/persistence/compiler/ui) pass.
- **Not verified:** the Hardware panel's gauge in the real running app (no E2E); an actual 30fps ROM build drawing more
  than 2048 triangles on real hardware or in an emulator (the DS's real per-frame draw time at 30fps hasn't been
  measured against this exact doubling, only reasoned from the frame-rate math). **Not built:** anything about
  `TASK.save-fps-target-in-project.md` itself (fps target is still ephemeral editor-session state, not saved in the
  project) -- this story only makes the two places that already receive an fps target act on it for the triangle
  budget; once that task lands, this scaling keeps working unchanged since it already reads from the same option/state.
