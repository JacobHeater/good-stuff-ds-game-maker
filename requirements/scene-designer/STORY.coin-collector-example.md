---
status: done
component: scene-designer
related: [STORY.labels-and-text.md, ../scripting/STORY.game-state-and-save.md, ../collision/STORY.ray-casts.md, STORY.animated-3d-models.md, STORY.mesh-colors.md]
---

# Story: A small real game (coin collector), to find what the engine can't do

## Context
The owner asked for an engine "good enough to build a full 3D game", and chose to find the gaps by building a small real game with it and fixing what blocks it.

## The game (`examples/coin-collector.gsds`; built from `createCoinGameProject()` in core `examples/coin-game.ts`)
Run around a walled arena (D-pad), jump (A) and collect six spinning coins while a red chaser walks toward you and sends you back to the start if it catches you. The top screen is the 3D view (a camera that follows the player);
the bottom screen is the HUD: coins, time, best time. Collecting all six shows a message and saves the best time; START plays again. Four scripts (Player, Coin, Chaser, CameraFollow), 26 nodes. It builds with no warnings.
Open the file with Project > Open; Export ROM or Play makes the ROM. (`GSDS_WRITE_EXAMPLES=1 pnpm test` regenerates the file from the code.)

## What building it found (each fixed, except where noted)
1. **Every mesh was the same grey**: fixed, see `STORY.mesh-colors.md`.
2. **No random numbers and no way to turn toward something**: fixed, `randi(n)`, `randf()` and `atan2(y, x)` (see below).
3. A script on many nodes needs each node's children named alike (all coins have a child called `CoinShape`; `$CoinShape` finds each coin's own): this already worked, but is easy to miss, so the example does it and says so.
4. `is_on_floor()` is false until a body has moved once, so "jump" is ignored on the very first frame: not changed (harmless).
5. **Not fixed / not in the game:** sound (supported, unused here), text joining a number and words in a script (`"HP: " + hp`: put `{}` in a label instead), several scripts can't share functions (each script has its own), no arrays/lists (six coins are six nodes),
   no enemy types beyond scripts, no per-scene music switch, no pause, no collision layers, no editor preview of animation.

## Random numbers and angles (added while building it)
- `randi(n)`: a random whole number from 0 to n - 1. `randf()`: a random float from 0 up to 1. `atan2(y, x)`: the angle in degrees, -180 to 180 (within half a degree), of the direction x, y.
- The generator is a xorshift seeded from the clock the first time it is asked, so a game plays differently each time.
- Checker, completion, codegen and runtime (`gs_randi`, `gs_randf`, `gs_atan2` in `gs_runtime.c`). Unit tests `core/src/script/script-random-atan.test.ts`; on the DS `testing/math-builtins.rom.test.ts` (11 angles, ranges and spread).

## Notes (built and verified)
- `compiler/src/coin-game.test.ts` (compiles clean), and `compiler/src/testing/coin-game.rom.test.ts` plays the game on the DS's CPU (emulator) with scripted button presses, frame by frame, against the real physics: 20 cases (landing, walking, the
  wall, the crate, jumping and not jumping in mid air, collecting a coin, six coins winning, the chaser closing in and catching the player, the camera following). A screenshot of the built ROM shows the colored scene and the HUD.
- **Not verified:** playing it by hand (no button input to the emulator here), the editor's own view of the example, saving the best time to a real SD card (the save is tested separately), restarting with START (the scene reload is tested elsewhere).
