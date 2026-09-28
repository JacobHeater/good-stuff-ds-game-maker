---
status: done
component: scene-designer
related: [STORY.sprites-on-the-2d-screen-of-a-3d-project.md]
---

# Bug: A script hiding a rotated sprite crashed the ROM (libnds assertion)

## Context
Owner report: attaching a script to a Sprite2D in a 3D project crashed on real hardware (melonDS), showing libnds's own assertion screen:
`sprite.h:532, !oam->oamMemory[id].isRotateScale — oamSetHidden() cannot set hide on a RotateScale sprite`.

`gs_sprites.c`'s `follow()` (called every frame for a sprite a script can reach) always called `oamSetHidden()` to match the node's `visible`. A
script that writes a sprite's rotation or scale (even just its position, which is enough for the compiler to give it a rotation matrix) makes it
a "rotate/scale" sprite in the DS's hardware terms. The hardware reuses the very same OAM bit for two different things: "hidden" on an ordinary
sprite, "double size" on a rotate/scale one. libnds enforces this with an assertion rather than silently doing the wrong thing, so calling
`oamSetHidden()` on a rotate/scale sprite always aborts, regardless of which way it's being set.

## Description
Hiding a rotate/scale sprite means dropping it out of rotate/scale mode for that frame (an ordinary sprite can be hidden normally) and back into
it when it's shown again. Its angle and scale live in a separate matrix slot, so leaving and re-entering rotate/scale mode doesn't lose them.

## Acceptance Criteria
```gherkin
Scenario: A rotated, script-controlled sprite can be hidden without crashing
  Given a Sprite2D on a 3D project's 2D screen, with a script that writes its rotation (or scale, or position) and sets visible = false
  When the ROM runs
  Then it doesn't hit the libnds assertion, and the sprite is genuinely not drawn

Scenario: It's shown again correctly afterward
  Given the same sprite, later set visible = true again by the script
  Then it reappears at its rotation and scale, undisturbed by having been hidden
```

## Notes
**Fixed** in `gs_sprites.c`'s `follow()`: for a sprite with an affine (rotate/scale) matrix, hiding it now calls `oamSetAffineIndex(oam, id, -1, false)` first (which turns rotate/scale off, making `oamSetHidden` legal) instead of calling `oamSetHidden` directly; showing it again calls `oamSetAffineIndex(oam, id, affineIndex, true)` and reapplies the rotation matrix. An ordinary (non-rotating) sprite is unaffected — it still hides the way it always did.

Verified on the DS (emulator): a new case in `testing/sprites-3d.rom.test.ts` — a sprite whose script sets `rotation = 45.0` then `visible = false` in `_ready()` (so the crash, if not fixed, happens on the very first frame, during ROM init) builds and boots without error, and the sprite is genuinely absent from the screen (compared against a reference of the same project with that one sprite marked invisible: matched 0.9993). The other three, non-scripted sprites — including a separate existing case that rotates sprites via project data alone, never reached by a script — were unaffected, confirming the bug only ever applied to a sprite that is *both* rotate/scale *and* dynamic (script-reachable); a static rotated sprite was never `follow()`-ed at all, which is why the existing test suite hadn't already caught this.
