---
status: proposed
component: compiler
related: [EPIC.compile-and-export-nds-rom.md]
---

# Spike: Compiler toolchain selection

## Context
Producing a real `.nds` ROM requires some toolchain. The realistic
options, roughly:

1. **Shell out to devkitPro/libnds** — generate C/C++ source (or a
   simpler intermediate) from the project's scene tree and hand it to
   the real, standard DS homebrew toolchain to produce the ROM.
   Authentic and battle-tested, but requires bundling or requiring an
   external toolchain install, and generating correct C/C++ from a
   TypeScript-defined scene graph is nontrivial.
2. **Build a custom code generator/runtime** targeting the DS's ARM7/
   ARM9 processors more directly, without going through devkitPro.
   Full control, but enormous scope — this is close to writing a game
   engine's runtime from scratch.
3. **Don't target real hardware compilation at all yet** — treat the
   in-editor preview (`run-games-locally/SPIKE.game-runtime-approach.md`)
   as the actual deliverable for the foreseeable future, and revisit
   real ROM export as a much later milestone once the editor itself is
   further along.

## Description
Investigate feasibility and cost of options 1 and 2, and give an
honest recommendation on whether option 3 (deferring this entirely) is
the right call for now given how much else in the project is still
unbuilt (persistence, scripting, asset import, the runtime itself).

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the three options above
  Then a written recommendation exists on which to pursue, or whether
    to explicitly defer this Epic
  And it states what (if anything) should be scoped as a Story next
```

## Notes
- It's completely acceptable for this spike to conclude "defer this
  Epic" — the point is to make that an explicit, reasoned decision
  rather than by default neglect.
