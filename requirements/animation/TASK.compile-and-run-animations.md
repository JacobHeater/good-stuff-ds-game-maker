---
status: done
component: animation
related: [STORY.animation-player-node.md, TASK.animation-model-and-persistence.md, TASK.animation-script-control.md, compiler/TASK.runtime-node-table-and-script-services.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md, testing/TASK.compiler-and-rom-regression-tests.md]
---

# Task: Build animations into the ROM and play them on the DS

## Description
**Compiler:** each kept `AnimationPlayer` gets its animations, tracks and keys in tables (times and values in the DS's 20.12 fixed point) and its node points at
it. A value that does not fit the number format is an `out-of-range` error naming the node. Every node an animation targets is kept (even if hidden) and, when
the track is a position, rotation or scale, made a node the runtime recomputes each frame. Diagnostics: `animation-not-started` (a warning) for a player with
animations where no animation is its autoplay and no script calls `play` on it; a track whose target node is not in the game (it was left out because it is not a
3D node kind the compiler keeps) is an error naming the animation. A player with no animations is left out with the warning `player-without-animations`.

**Runtime** (`runtime/source/gs_animation.c`): each player has a playing animation (or none), a time and a speed. Each frame, after the scripts and before the node
transforms are computed, every playing player advances by `delta * speed`; at the end of a looping animation the time wraps, otherwise the animation stops on its
last frame; then each of its tracks writes the blended value into the target's position, rotation, scale or visibility (or the audio player's volume or pitch).
Autoplay animations start when the game starts. The blend is a straight line in fixed point and follows the same rule as `sampleAnimation` in core.

**Verification** (on the DS, no host C compiler): the runtime's blend is compared with `sampleAnimation` at many times for many random tracks (within one
fixed-point step); loop, stop-at-end, restart, replace, speed, stop, autoplay and "an animation wins over a script in the same frame" are each checked on the DS;
and a scene with an autoplay animation is run on the emulator and compared with renders of the same scene with the node placed by hand (and one started by a
script from the D-pad).

## Acceptance Criteria
```gherkin
Scenario: Tables reach the ROM
  Given an AnimationPlayer with one animation of two tracks
  Then the scene description has the animation, its tracks and keys in 20.12, and the player's node points at them

Scenario: Targets are kept and made movable
  Given a hidden node that a visibility track animates
  Then it is in the ROM (hidden), and a node with a position track is recomputed every frame

Scenario: The blend is right on the DS
  Given random tracks and times
  Then the DS's value is within one fixed-point step of the TypeScript sampling

Scenario: Playing
  Then a looping animation wraps, a non-looping one stops on its last frame and is_playing() becomes false, play restarts, stop freezes, speed scales

Scenario: Animation wins
  Given a script that writes a node's position every frame and an animation with a position track for it
  Then while the animation plays the node is where the animation says

Scenario: Warnings and errors
  Given an AnimationPlayer nothing starts
  Then Export ROM warns; a player with no animations is left out with a warning

Scenario: On the emulator
  Given an autoplay animation that moves a cube, and another that a script starts with the D-pad
  Then the cube is where the animation puts it (checked against renders of the scene with the cube placed by hand)
```

## Notes (built and verified)
- **Compiler:** `DsAnimationPlayer`, `DsAnimation`, `DsAnimationTrack`, `DsAnimationKey` and the four tables in `scene_data.c` (`animKeys`, `animTracks`, `animations`,
  `animationPlayers`) with `GsNode.animPlayer`; the diagnostics `animation-not-started`, `player-without-animations`, `animation-target-missing` (14 tests in `animation.test.ts`).
  A hidden player's animations don't count and what only they animate is not kept.
- **Runtime:** `runtime/source/gs_animation.c`; `gs_update_animation(delta)` runs after the scripts and before `gs_update_nodes` in `main.c` (so an animation wins over a script that
  writes the same property while it plays), and `gs_init_animation` starts the autoplay animations. The blend is one 64-bit multiply and the DS's hardware divider per component, which
  is within one fixed-point step of exact.
- **Verified on the DS:** `animation.rom.test.ts` (31): random position, rotation and scale tracks and a random visibility track at about 200 times agree with core's `sampleTrack` to
  within 2 fixed-point steps (visibility exactly); a straight animation at 0.5 s, the end of a non-looping animation and `is_playing`, looping and wrapping (2.5 s and 4.25 s into a 2 s loop),
  many small frame steps adding up, restarting, stopping, one animation replacing another, speed (2x, 0.5x, kept between 0.05 and 10), autoplay from init, an animation winning over a script in
  the same frame and the script having the property again once it ends, scripts that play, stop and speed up from the buttons, and calls with bad indexes doing nothing.
- **Through the editor:** `GSDS_ANIMATION_ROM_PROJECT=<the path animation.mjs prints> pnpm test:rom` builds the animations made in the UI and runs them in melonDS: the autoplay animation slides
  the cube to x = 2 and leaves it there (silhouette overlap 0.962 with the right picture, 0.000 with the cube still at -2), and tapping A makes the script play the animation that tilts it 45
  degrees (0.912 against 0.715 for not tilted).
- **Limits:** one animation plays at a time per player; times and values are 20.12 fixed point (a key value beyond about 500000 is an `out-of-range` error naming the player); a rotation blends the
  numbers as written (350 to 10 goes the long way round); no easing curves, blending, events or reverse playback.
