---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.scene-instances.md, STORY.inventory.md]
---

# Story: Spawn pools (runtime-placeable, pre-compiled object instances)

## Context
Owner was designing an island explore-and-survive game and asked for something like
`InstanceScene("Campfire", x, y, z)` to place a crafted object wherever the player wants, at runtime. True dynamic
creation is impossible on this engine (and on real DS hardware): every node, sprite, and script instance is a
fixed compile-time slot -- there is no dynamic scene graph, no heap-allocated entity system. The real, buildable
version: an **object pool**. At compile time, reserve N pre-expanded, initially-hidden copies of a template scene;
a script calls `spawn("Name", x, y[, z]) -> int` to find a free copy, reposition it, and show it, getting back a
handle; `despawn(handle)` hides it again, freeing the slot for reuse. Owner confirmed this tradeoff (a cap, not
infinite placement) and chose this as the first of several engine additions to build, ahead of arrays, timers, and
an AI/pathfinding helper (not yet started).

## Description
- **Data model** (`packages/core/src/scene-node.ts`): one new optional field, `spawnPoolCount?: number`, sibling to
  the existing `instanceOf`. A pool node *is* an instance node (same `instanceOf` target, same single-node shape)
  -- this field just says "and make N of them, each independently spawn()/despawn()-able," instead of the one
  always-shown copy an ordinary instance is. Absent or `1` means an ordinary instance, unchanged. `packages/core/src/spawn-pool.ts`:
  `SPAWN_POOL_COUNT_MIN = 1`, `SPAWN_POOL_COUNT_MAX = 16` (conservative vs. Inventory's 64 -- a pool slot duplicates
  a whole subtree's worth of sprites/triangles, not one scalar), `clampSpawnPoolCount`, `isSpawnPool`.
- **`expandSpawnPools`** (`packages/core/src/project-scenes.ts`, sibling to `expandSceneInstances`, reusing its
  `renamedSubtree` helper): walks the tree *before* `expandSceneInstances` runs. For each node with
  `spawnPoolCount = N > 1`, replaces it with N sibling nodes at the same tree position, each an ordinary
  `instanceOf` node (`spawnPoolCount` stripped, `visible: false`), which `expandSceneInstances` then expands
  exactly as it already does today, unmodified. Returns `{ tree, pools: [{ poolNodeId, name, sourceSceneId, screen, copyRootIds }] }`.
  Nested pools (a pool's own template containing another pool) are refused with a new `nested-spawn-pool`
  diagnostic -- no sensible runtime fallback exists, unlike a missing scene's "becomes an empty node" softness.
  Checked both at compile time and proactively in the editor (`spawnPoolWouldNest`, mirroring `instanceWouldCycle`).
  Pool name resolution is the pool node's own `name` -- `spawn("Name", ...)` resolves the same way `$Name` already
  does, including the same ambiguity handling, no new project-wide uniqueness system.
- **Forcing pool content into the live/dynamic set**: right after `checkProjectScripts` builds its touched/dynamic
  sets, pool copies' own node ids are injected.
  - **3D** (`translate-scene-3d.ts`): each copy's root id only, added to `scripts.touchedIds`/`dynamicRootIds` --
    cascades `dynamic: true` to the whole subtree via the existing `parentDynamic` composition, since 3D composes
    a node's world transform from its parent's every frame.
  - **2D** (`translate-scene-2d.ts`): 2D has **no** parent-child position composition at all (every node's position
    is always absolute screen pixels) -- so *every* node in each copy's subtree, not just the root, is added to
    `scripts.touchedIds`, no cascade, no cheaper alternative.
- **New compiled table, `DsSpawnPool`/`GsSpawnPool`** (modeled on `DsInventory`/`GsInventory`): `{ nodeStart, nodesPerCopy, count, screen? }`
  (2D-only `screen`). The key invariant, guaranteed by construction (N copies are tree *siblings*, so depth-first
  flattening visits one copy's entire subtree before the next) and covered by a dedicated test: slot `i`'s own
  root is always node index `nodeStart + i * nodesPerCopy`. Built by `collectSpawnPools`, threaded through
  `ds-scene.ts`, `scene-data-writer.ts`, and both runtime headers (`scene.h`, `scene2d.h`).
- **Runtime C**:
  - **3D** (new `packages/compiler/runtime/source/gs_spawn.c`): one `uint8_t *used` array per pool. `gs_spawn(pool, x, y, z) -> int`:
    linear-scans for a free slot, on success sets only `gs_node_state[rootIdx].position`/`.visible = 1` and returns
    an opaque handle `(pool << 16) | slot`; the already-dynamic subtree composes itself from there every frame, no
    new drawing path. `gs_despawn(handle)`: clears `used[]`, `visible = 0`. `gs_is_spawned(handle) -> int`: a pure
    state check.
  - **2D** (`runtime2d/source/gs_runtime2d.c`): same `used[]`/handle scheme, but `gs_spawn` loops over the *entire*
    copy range, writing each node's position as its own authored position (read straight out of the existing,
    read-only `gs_scene2d.nodes[]` table -- `gs_init_nodes2d` already copies it into the mutable `gs_node_state`
    once at scene start and never touches it again, so no new compiled "origin" table was needed) shifted by how
    far the root moved. `gs_despawn` hides the whole range unconditionally (safe, since nothing draws once hidden).
- **Script API**: `ast.ts` gained `{kind:"spawnCall"; pool}`/`{kind:"despawnCall"; method}`; `checker.ts`'s
  `RESERVED_NAMES` gained `spawn`/`despawn`/`is_spawned`, with `ScriptSceneContext.spawnPools`/`spawnArgCount` and
  dedicated `checkSpawnCall`/`checkDespawnOrIsSpawned` methods; `script-codegen.ts` emits `gs_spawn`/`gs_despawn`/
  `gs_is_spawned` calls. The handle is a plain `int` -- deliberately *not* a new language-level "node reference"
  type (the checker already disallows a node as a value, and shouldn't be taught otherwise for this).
- **Editor**: authoring a pool is otherwise identical to authoring a scene instance (same "Instantiate Scene" flow)
  -- the only new UI is a "Pool count" field in `InspectorPanel.tsx`'s existing `instanceOf` block, bound to a new
  `setSpawnPoolCount` action. `shown-scene.ts`'s `useShownSceneRoot` (what both viewports and the Hardware budget
  panel read from, since `BUG.triangle-budget-ignores-scene-instances.md` fixed the same class of bug once already
  for ordinary instances) gets `expandSpawnPools` added before `expandSceneInstances`, so the live budget gauge
  doesn't under-report pooled content the same way.
- **v1 scope, explicitly out**: no `move_spawned` (a spawned copy has no `$Name`, nothing to move it afterward
  except `despawn`); no cross-scene pools (a pool's copies live in the one scene the pool node is placed in, same
  as an ordinary instance); a template's own `_ready()`/`_process()` already runs per-copy for free, the same
  mechanism that already makes an ordinary instance's script work per-instance. `spawn()` returns `-1` on an
  exhausted pool; a script must check for it, no runtime queueing/overflow diagnostic.

## Acceptance Criteria
```gherkin
Scenario: A pool with no spawns yet draws nothing
  Given a 2-slot spawn pool whose template is visible by default
  Then neither copy is shown until spawn() is called

Scenario: Spawning places a copy at the given position
  Given a spawn pool with a free slot
  When a script calls spawn("Name", x, y[, z])
  Then a hidden copy becomes visible at that position, and nothing else changes

Scenario: An exhausted pool returns -1 and spawns nothing new
  Given every one of a pool's N copies is already spawned
  When a script calls spawn() on it again
  Then it returns -1 and no additional copy appears anywhere

Scenario: Despawning frees a slot for reuse
  Given a spawned copy and its handle
  When a script calls despawn(handle)
  Then that copy hides, and a later spawn() on the same pool may reuse its slot

Scenario: A pool's content shares the same compile-time budget as ordinary nodes
  Given a screen already at its sprite/triangle budget
  When a spawn pool's N copies would push it over
  Then the same too-many-sprites/over-triangle-budget diagnostics fire, unchanged

Scenario: Nesting a pool inside another pool's template is refused
  Given scene B contains a spawn pool
  When scene A's own pool is set to instance B
  Then a nested-spawn-pool error is raised, both in the editor and at compile time
```

## Notes
- **A real runtime bug, caught by the permanent hardware test, not by any unit test**: the first draft of 2D's
  `gs_spawn` restored *every* node's `visible` bit in a copy's subtree from the compiled, read-only `gs_scene2d.nodes[]`
  table -- including the root's. But a pool copy's root is *always* compiled with `visible: false` (that's what
  makes it a hidden pool copy to begin with), so spawning it re-hid it on the very same frame, and nothing ever
  appeared on screen. 3D's `gs_spawn.c` had already gotten this right (`gs_node_state[rootIdx].visible = 1`,
  hardcoded, not read from the table) because the root is the *only* node 3D's own version ever touches directly.
  The 2D port, needing to loop over a copy's whole subtree for the position fix-up, carried the table-read pattern
  onto the root by mistake. Fixed by special-casing the root (`n == 0`) to force `visible = 1`, while every other
  node in the subtree still correctly restores its own authored bit (a child a template already hides on purpose
  -- shown later by its own script, say -- must stay hidden on spawn too). This is exactly the class of bug the
  sky box story's own "shipped with only a manual check" mistake warned against, and is why this feature got a
  permanent hardware test instead of trusting the compiler-level unit tests alone.
- **A mid-implementation correctness correction, caught during design, not implementation**: `spawn`'s own x/y/z
  arguments were initially going to be forced to `int`-type the way Inventory's `slot`/`count` arguments are --
  wrong, since these are positions, not counts. Fixed to follow the `move_and_collide`/`ray_cast` precedent instead
  (an `isNumeric` check, no forced `int`, uniform float conversion in codegen).
- **A design simplification found during planning, before any code was written**: the original sketch for 2D's
  position fix-up proposed a brand-new compiled "origin" table recording each node's authored starting
  position/visibility. Recognized as unnecessary: the existing, read-only `GsNode2D`/`GsNode` `nodes[]` table
  (which `gs_init_nodes2d`/`gs_init_nodes` already copy from once, at scene start, into the mutable
  `gs_node_state`/`gs_node_state2d`) already holds exactly this data -- `gs_spawn` (2D) just reads it directly, no
  new runtime table in either tree.
- **Hardware verification**: `packages/compiler/src/testing/spawn-pools.rom.test.ts` (permanent), 2D tree only --
  3D's own mechanism (the dynamic-node world-transform cascade) is already hardware-proven by many other 3D
  stories' tests, making it comparatively low marginal risk; 2D's per-node position/visibility restore is the
  genuinely new runtime machinery this story added, and is what the test is built to catch a regression in. One
  ROM, five independent captures, each a complete, deterministic sequence of button taps from a cold start
  (`is_button_pressed`, edge-triggered -- melonDS captures don't persist state between calls, so each capture
  replays its own full sequence rather than building on a previous one): idle (nothing spawned, a Label's own
  text-width shows the default handle's value); tapping "a" (the first copy spawns at a fixed point, nowhere
  else); tapping "a" then "b" (both copies show, at their own points); tapping "a", "b", then "x" (the pool is
  exhausted -- the third spawn draws nothing, and the returned `-1` is read back through a Label, distinguished
  from the idle default by giving the two values different display widths, not by width alone -- see below);
  tapping "a", "b", then "y" (despawning the first copy frees its slot, reused by a fourth spawn elsewhere).
- **A test-construction mistake caught and fixed before trusting the suite**: the "exhausted pool returns -1" check
  originally displayed the raw handle value through a Label and compared its rendered text width. But `-1` ("H-1")
  and the idle default `-2` ("H-2") render at the *same* width -- the check would have passed even if the script
  never updated the value at all, silently failing to verify the one thing it claimed to. Fixed by displaying
  `handleC + 11` instead (`-2` -> `9`, one digit; `-1` -> `10`, two digits), so the two cases are genuinely
  distinguishable by width.
- **Not built:** `move_spawned`; cross-scene pools; any runtime diagnostic for an exhausted pool beyond the `-1`
  return value a script must check itself; timers, arrays, and an AI/pathfinding helper (the three other engine
  additions the owner identified wanting, not yet started).
