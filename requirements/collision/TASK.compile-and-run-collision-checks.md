---
status: done
component: collision
related: [STORY.collision-shapes-and-overlap-checks.md, TASK.script-overlaps-check.md, compiler/TASK.compile-scripts-to-c.md, compiler/TASK.runtime-node-table-and-script-services.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md, testing/TASK.compiler-and-rom-regression-tests.md]
---

# Task: Build collision shapes into the ROM and test overlap on the DS

## Context
`STORY.collision-shapes-and-overlap-checks.md`. The compiler ignored `CollisionShape3D`; the runtime has no shapes.

## Description
**Compiler:** each kept `CollisionShape3D` gets a collider entry (shape, and its size in the DS's 20.12 fixed point: half extents for a
box, radius, half height) and its node's table entry points at it. A size that doesn't fit the number format is an `out-of-range`
error naming the node. A `CollisionShape3D` that no script passes to `overlaps()` gets the warning `collision-shape-unused`. The
`overlaps(a, b)` call is compiled to a call into the runtime with the two node-table indices. Nodes a script only names in
`overlaps()` are *not* made dynamic (only written nodes are).

**Runtime** (`source/gs_collision.c`, `gs_overlaps(a, b)` in `gs_api.h`): true when both nodes have a collider, both are visible in the
world, and their shapes share a point. The test is GJK (the standard convex-shape intersection method) on the *world-space* shapes, each an
affine image (the node's rotation and per-axis world scale, then its position) of a box, sphere, capsule or cylinder, using each shape's
support function; it works in 20.12 fixed point with 64-bit intermediates, first rejecting pairs whose bounding spheres are apart, and
works relative to one shape's center so the numbers stay small. The shape functions are separate from the node table
(`gs_shapes_overlap` takes two explicit shape descriptions) so a test can drive them with any input.

**Verification** (no host C compiler exists, so on the DS): an independent oracle in TypeScript (a different method, minimising the support
function of the shapes' difference over a dense set of directions) is compared with the DS on hundreds of random pairs of shapes, at random
rotations and uneven scales, ignoring cases within 2 % of touching; plus hand-worked exact cases for each pair of shape kinds; plus a real
scripted scene on the emulator where a shape is moved into and out of another.

## Acceptance Criteria
```gherkin
Scenario: Shapes reach the ROM
  Given a project with a box shape and a sphere shape that a script passes to overlaps()
  Then the scene description has two colliders and their nodes point at them, with half extents and radius in 20.12

Scenario: An unchecked shape is warned about
  Given a collision shape no script names in overlaps()
  Then the compile succeeds with a collision-shape-unused warning naming the node

Scenario: Every pair of shape kinds, on the DS
  Given random pairs of boxes, spheres, capsules and cylinders at random rotations and scales
  Then the DS agrees with the independent oracle on every pair that is not within 2 % of touching

Scenario: Worked cases
  Given two unit boxes 0.9 apart, then 1.1 apart; a box rotated 45 degrees; a sphere against a box corner; a capsule standing against a cylinder
  Then the DS gives the answers worked out by hand

Scenario: A hidden shape never overlaps
  Given two overlapping shapes, one of them hidden (or under a hidden node)
  Then overlaps() is false on the DS

Scenario: Moving shapes are followed
  Given a script that moves a shape (or the mesh it is under) each frame with the D-pad, and checks overlaps() against a fixed shape
  When the shape is moved into the other and out again on the emulator
  Then a cube shows the overlap exactly then
```

## Notes (built and verified)
- **Compiler:** `DsCollider` and `DsNode.collider`, the `GsCollider` table, `collision-shape-unused` (13 tests in `collision.test.ts`). The regenerated fallback
  `scene_data.c` and the layouts in the older tests changed with the new fields.
- **Runtime:** `runtime/source/gs_collision.c`, `include/gs_collision.h`. GJK in its distance form (closest point of a small simplex to the origin, repeated) on the
  shapes' support functions, in 20.12 fixed point held in 64 bits. Two things were found by running it on the DS, not by reading it: (1) the search direction must
  come from the simplex's exact edge or face normal, not from the closest point (which is only known to a working unit, so a few units long it points tens of
  degrees off, and the search then went round in circles for 64 rounds with the identical state each time; it now gets the answer in a few rounds); (2) the
  working range had to be 15 bits (with products of dot products formed from shifted values) for the answer to be right within about 0.05 units near touching.
- **How it was checked, on the DS:** `collision.rom.test.ts` (102 tests): 55 hand-worked cases (each pair of shape kinds, rotated, uneven and mirrored scale, a
  cylinder lying down, a capsule leaning, ellipsoids), and seeded random pairs of every combination at three sizes (ordinary, 6 x, 0.3 x) at random rotations and
  scales, against the independent oracle in `testing/collision-oracle.ts` (a different method in double precision: the smallest support function of the shapes'
  difference over 40 000 directions, refined). A heavier run (`GSDS_COLLISION_STRESS=8`) checked 5 175 pairs with no disagreement. Breaking the cylinder's radius
  on purpose fails exactly the cylinder tests. `collision-scene.rom.test.ts` (21): the node-level `gs_overlaps` in a compiled scene (position, scale, rotation,
  visibility, a parent moving, scaling or hiding, indices that aren't nodes). `collision-game.rom.test.ts`: a real game loop on the emulator with the D-pad held,
  where a flag appears exactly when the player's shape overlaps the wall's (silhouette overlap 0.967 with the right picture against 0.693 with the wrong one), and
  the same game authored entirely through the editor UI (`GSDS_COLLISION_ROM_PROJECT`, 0.994 against 0.565).
- **Same frame:** `gs_overlaps` brings the two nodes (and their parents) up to date first (`gs_refresh_node`), so a script that moves a node and then checks it in the
  same `_process` sees the new position rather than last frame's.
- **Cost:** about 0.4 to 0.8 ms per check on average for every pair of shapes and at most about 2 ms in the tests (a pair whose bounding spheres are apart is settled in
  microseconds). At 60 frames a second a frame is 16.7 ms, so a handful of checks per frame is fine and dozens would not be. The largest number this saw was not a
  whole frame; before the direction fix one check took 15.7 ms.
- **Known limits:** the answer is within a hair of touching, not exact there (about 0.001 units for ordinary shapes, more for very large ones: the working size is
  fixed, so a pair of shapes 30 units across is resolved to about 0.008 units); shapes far larger than about 4000 units are not supported; capsules and cylinders stand
  along the node's own Y axis only; a shape hidden by `visible` is off, but there is no separate "disabled" flag.
