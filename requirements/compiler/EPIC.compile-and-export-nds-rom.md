---
status: proposed
component: compiler
related: [SPIKE.compiler-toolchain-selection.md, persistence/EPIC.project-persistence.md, run-games-locally/SPIKE.game-runtime-approach.md]
---

# Epic: Compile and export a real .nds ROM

## Context
Nothing in this component exists yet. Every other piece of "running" a
game built in this editor — the Play button, the Debugger tab — is
either a stub or, at best, an in-editor simulation. Actually producing
a real, runnable Nintendo DS ROM (`.nds`) from a project built in this
editor is a distinct, large body of work that hasn't been started or
even scoped.

## Narrative

Everything built so far (the scene model, the hardware budget
tracking, the 2D/3D viewports) is aimed at authoring a DS game
accurately, but authoring accuracy doesn't produce a runnable game by
itself. At some point, a project needs to become an actual `.nds` file
that runs on real hardware or in a real emulator — the way Godot
ultimately exports a runnable game binary, not just an editor project.

This is a substantial, currently-undesigned piece of the system. Real
DS homebrew today is built with a compiled C/C++ toolchain
(devkitPro/libnds) — there's a real question of whether this project
generates C/C++ source and shells out to that toolchain, embeds/
reimplements some subset of it, or takes another approach entirely.
That question is out of scope for this Epic to answer directly; it
belongs to `SPIKE.compiler-toolchain-selection.md`.

This Epic also depends on project persistence
(`persistence/EPIC.project-persistence.md`) existing
first — there's nothing to compile until a project can be saved to
disk in a well-defined format — and its scope will be shaped by
whatever `run-games-locally/SPIKE.game-runtime-approach.md` decides
about in-editor preview vs. real-hardware execution, since a real
compiler may end up being needed only for final verification rather
than everyday iteration.

No Stories exist under this Epic yet, deliberately — it's too early to
commit to specific acceptance criteria before the toolchain question
is resolved.
