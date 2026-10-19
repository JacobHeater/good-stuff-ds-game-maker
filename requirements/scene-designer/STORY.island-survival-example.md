---
status: done
component: scene-designer
related: [STORY.coin-collector-example.md, STORY.spawn-pools.md, STORY.inventory.md, STORY.inventory-ui-panel.md, STORY.tile-map-3d.md, ../sprites/STORY.sky-box-3d.md]
---

# Story: A second small real game (island survival), to exercise everything built since the coin collector

## Context
Follow-up to `STORY.coin-collector-example.md`, the engine's first "build a small real game to find what's missing"
exercise. Several real features have shipped since then that the coin game never touches: TileMap3D, SkyBox3D's
day/night cycle, the Inventory node (+ its on-screen panel), and spawn pools -- the exact feature the owner asked
for while designing this same island-survival concept earlier in the conversation. Asked for "a new test game that
uses all the features so far," built the same way the coin game was: by hand, via `createSceneNode()` calls, no
editor UI involved.

## The game (`examples/island-survival.gsds`; built from `createIslandSurvivalProject()` in core `examples/island-survival.ts`)
Walk a small island (D-pad), jump (A), chop trees and pick up coconuts for Wood and Coconut (shown in an Inventory
panel on the bottom screen), place a campfire (B, costs 2 Wood, a 3-slot spawn pool) or put out the last one you
placed (X), and don't let the wandering crab catch you (it steals a Wood) or walk off the island's edge (costs a
life, same "send back to the start" shape as the coin game's chaser catching the player; losing the last life
saves the best day reached). A day/night cycle (two `SkyBox3D` nodes swapped by a timer) runs throughout. Six
scripts (World, Player, Tree, Coconut, Crab, CameraFollow), ~34 nodes. Builds with no warnings.

## What building it found (each fixed, except where noted)
1. **A real bug in the brand-new 2D spawn-pool runtime, caught by this story's own permanent hardware test, not a
   unit test**: see `STORY.spawn-pools.md`'s own notes -- `gs_spawn` (2D) restored every node's `visible` bit from
   the compiled table, including the root's, which is always compiled `visible: false`. Fixed there, not here, but
   this game (specifically its permanent ROM test, `testing/spawn-pools.rom.test.ts`) is the reason it was caught
   before being called done.
2. **An invisible-but-solid floor is dropped from the compiled scene entirely -- not a bug, a real gap in how I
   first authored it.** The island's own `Ground` collision volume was first built the same way `coin-game.ts`'s
   walls are (a `MeshInstance3D` + `CollisionShape3D` child), with `visible: false` so nothing draws where the
   tile-mapped floor already shows the grass. But an invisible node that no script ever names is pruned from the
   compiled node table *entirely* -- not merely hidden, structurally absent, shape and all (`translate-scene-3d.ts`'s
   own `visit`: `if (!node.visible && !containsTouched(node)) return;`, before recursing into children at all).
   This is documented, intentional behavior (`requirements/collision/STORY.solid-shapes-and-move-and-collide.md`:
   "a hidden solid shape stops nothing," so a script can open a door by hiding one -- and an invisible node nothing
   can ever reveal is dead weight, correctly removed). `coin-game.ts`'s own ground/walls only survive because they
   stay *visible* throughout. **Caught by a direct ray_cast probe, not by any actual gameplay symptom in the ROM
   test suite itself** (every other test positioned the player by direct `position.y` writes, never actually
   letting it fall and land) -- in the real game, as first written, the player would have fallen through the floor
   forever. Fixed with a new `collider()` helper: a plain `Node3D` (which draws nothing by design, unlike a
   `MeshInstance3D` with `visible: false`) left *visible*, with the `CollisionShape3D` child under it -- survives
   compilation, draws nothing, stays solid.
3. **`ray_cast` detects *any* solid shape along its path, not specifically "the ground right here"**: the crab's
   own cliff-avoidance ray can be fooled by an unrelated solid (the player, a tree) happening to sit along its
   down-forward sample line, reading "ground is there" when the real ground underneath has actually run out. Not
   fixed (a real, documented v1 limitation of this engine's `ray_cast` -- it returns only a distance, never which
   node it hit, so there is no way to ask "is this specifically ground" -- "no AI/pathfinding helper" is already a
   known, not-yet-built gap). Mitigated in this game only by scale (a small island, three trees, one player) that
   makes a false "ground is there" reading rare enough to not be the game's point.
4. **A real test-construction mistake, caught while diagnosing the above, not an engine bug**: the "place a
   campfire" ROM test positioned the player at a point that, by coincidence, overlapped a tree closely enough to
   also trigger that tree's own chop logic in the same frames -- refunding the 2 Wood the campfire placement had
   just spent, in the same frame, making the test look like campfire placement didn't actually spend anything.
   Fixed by moving the test's own player position well clear of every tree and coconut (>= 2.2 units from all
   six).
5. **A second real test-construction mistake, same diagnosis pass**: the "crab steals a Wood" test teleported the
   crab to the player's exact position, then let its own `_process` run once -- but that script moves the crab
   (`move_and_collide`) *before* checking the overlap, so if that move resolves a starting penetration against the
   player's own solid shape by pushing the crab away, the overlap check at the end of the same call never sees
   them together at all. Fixed by forcing the crab back onto the player at the start of every frame across a
   short run, so the overlap is checked while genuinely co-located at least once, matching how a real approach
   (closing a gap over many frames, not teleporting into a probably-illegal already-overlapping state) would
   actually play out.
6. Everything else (TileMap3D's own grass island, the day/night `SkyBox3D` pair, the Inventory panel showing Wood
   and Coconut, `randi`/`atan2`-style wandering via `sin`/`cos` of a random angle, `save_game`/`load_game`,
   `change_scene` to restart) worked exactly as each feature's own story already promised -- no further gaps found.

## Acceptance Criteria
```gherkin
Scenario: Chopping a tree or picking up a coconut fills the Inventory
  Given the player walks into a visible tree (or coconut)
  Then it disappears and the matching item count in the Bag goes up

Scenario: A campfire can be placed with enough Wood, spending it, and not placed without enough
  Given the player has >= 2 Wood and presses B
  Then a hidden campfire slot becomes visible at the player's own position and 2 Wood are spent
  Given the player has < 2 Wood and presses B
  Then nothing is spent and nothing becomes visible

Scenario: The campfire pool is bounded, and a placed one can be put out
  Given all 3 campfire slots are already lit
  When the player presses B again, even with Wood to spend
  Then nothing new lights and nothing more is spent
  When the player instead presses X
  Then the last campfire placed is hidden again and its slot is free for reuse

Scenario: The crab is a real, if foolable, hazard
  Given the crab catches the player
  Then one Wood is taken from the Bag, if there is one to take

Scenario: Walking off the island costs a life; losing the last one saves the best day and ends the round
  Given the player's own height drops below the island's own floor
  Then the player is sent back to the start and a life is lost
  Given that was the last life
  Then the best day reached is saved and a message shows, until START restarts the scene
```

## Notes
- **Hardware verification**: `packages/compiler/src/testing/island-survival.rom.test.ts` (permanent), using the
  same `runDump` CPU-exact harness `coin-game.rom.test.ts` already established (not melonDS pixel capture --
  reads the compiled game's own state back through C expressions after replaying scripted button sequences), 13
  cases. Deliberately scoped to the *new* integration surface this game adds on top of already-proven mechanics
  (movement/jumping/overlaps/labels/save/change_scene all come straight from the coin game's own playbook, and
  TileMap3D/SkyBox3D/Inventory/spawn pools each already have their own dedicated hardware test): chopping/picking
  up into the Inventory, spending Inventory items on a spawn-pooled campfire (and the pool's own 3-slot cap and
  despawn-to-reuse), the crab's ray_cast-based wandering and its overlap-triggered theft, falling off costing a
  life and triggering save-on-game-over, and the day/night cycle's own timer-driven `SkyBox3D` swap. All 13 pass.
- **Compiler-level verification**: `packages/compiler/src/island-survival.test.ts` -- compiles with zero
  diagnostics; confirms the compiled scene carries exactly one spawn pool with 3 slots and the four expected
  globals (`bestDay`, `day`, `lastFire`, `lives`).
- **Persistence**: `packages/persistence/src/json/example-projects.test.ts` -- the project round-trips through
  JSON (serialize, deserialize, re-validate) byte-for-byte equivalently; `GSDS_WRITE_EXAMPLES=1 pnpm test` writes
  `examples/island-survival.gsds`, same mechanism `coin-collector.gsds` already uses. Open via Project > Open;
  Export ROM or Play builds the real ROM.
- **Not verified**: playing it by hand in the editor or on real hardware (no button input harness for either here
  -- the `runDump` harness replays scripted input against the compiled game's own logic, not a human play session);
  the exact "is this fun/balanced" question (lives, campfire cost, crab aggression are all first-guess numbers,
  not tuned).
- **Not built**: the three other engine additions the owner identified wanting alongside spawn pools (timers,
  arrays, an AI/pathfinding helper) -- this game's own crab is a deliberately simple stand-in for "AI" using only
  what already exists (`randi`, `atan2`-style `sin`/`cos`, `ray_cast`), not a preview of a future pathfinding
  helper.
