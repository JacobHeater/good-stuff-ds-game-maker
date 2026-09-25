---
status: done
component: collision
related: [EPIC.collision-shapes.md, STORY.collision-shapes-and-overlap-checks.md, TASK.compile-and-run-collision-checks.md, TASK.script-overlaps-check.md, scripting/TASK.script-language-front-end.md, scripting/TASK.script-editor-and-attachment.md, compiler/TASK.runtime-node-table-and-script-services.md]
---

# Story: Solid shapes are the ground: move a body and have it stopped

## Context
`STORY.collision-shapes-and-overlap-checks.md` lets a script ask whether two shapes overlap. A platformer needs more: gravity must stop at the
floor the level actually has, a wall must stop a walk, a ceiling must stop a jump. The example player script (`tests/prototypes/scripts/player-jump.gsscript`)
had to use one fixed floor height. The Epic listed physics as out of scope; this is the smallest useful piece of it.

## Decisions (made with the product owner)
- **API: solid shapes plus a move call.** A shape can be marked **Solid** in the Inspector. A script moves a body with
  `move_and_collide(dx, dy, dz)`; the body is stopped by solid shapes, and `is_on_floor()` says whether it is standing.
- **Floors, walls and ceilings** all work (a move is stopped whichever way it hits). Moving platforms that carry the player are **not** part of this.

Choices I made without asking (say if any is wrong):
- **A body is a node with collision shapes under it** (the way a Godot character body owns its shapes): a player mesh with a `CollisionShape3D` child. The
  call is made on the body, `move_and_collide(...)` for the node the script is attached to or `$Player.move_and_collide(...)`. A node that is itself a
  `CollisionShape3D` is its own body. A node with no shape under it is an error.
- **What stops a body:** every *visible* shape marked Solid that is not under the body itself. Other shapes (not solid) never stop anything; they are
  still for `overlaps()`. A hidden solid shape stops nothing (so a script can open a door by hiding it).
- **The move is in the body's own `position` units** (the same units and axes as `position.x += ...`) and is made one axis at a time, **Y first, then X,
  then Z**, so a body blocked in one direction still slides along the others (walk into a wall diagonally and you slide along it). Each axis moves as far
  as it can without the body's shapes overlapping a solid one. A long move is taken in steps of at most a quarter of a unit, so a fast fall does not pass
  through a thin floor.
- **The body stops a hair short of what it hits** (0.01 units) so it does not sit exactly touching, which the overlap test counts as overlapping.
- **`move_and_collide` returns true if anything blocked it.** `is_on_floor()`, `is_on_wall()` and `is_on_ceiling()` report what the body's **last** move ran
  into: moving down into a solid is the floor, up is the ceiling, sideways is a wall. They stay set until the next move.
- **A body that starts inside a solid shape is not stopped by what it is already in:** it moves freely until it is out (and then collides as usual), so it can
  always get out. Start a player above the ground.
- **Cost:** a move costs about one overlap check (about half a millisecond on the DS) for each of the body's shapes and each nearby solid shape, per axis,
  and about eight more per axis when it hits something. A few bodies against a level of a few dozen solid shapes is fine; the tests measure it.

## Description
- **Solid** is a checkbox in the Inspector of a `CollisionShape3D` (`collision.solid` in the project file, default off). A solid shape is drawn in a
  different color from the others in the viewport, so the ground can be told apart.
- **Language** (on a node with shapes, `self` or `$Name`): `move_and_collide(dx, dy, dz)` (bool; the three are `float` or `int`), `is_on_floor()`,
  `is_on_wall()`, `is_on_ceiling()` (bool). The node that moves is treated like a node whose position a script writes, so it (and everything under it) is
  recomputed every frame.
- **Warnings:** a solid shape is used when some script calls `move_and_collide`; a body's own shapes are used by the call. A shape neither of those uses
  still gets the `collision-shape-unused` warning.
- **The example player** now lands on solid shapes instead of a fixed height.

## Acceptance Criteria
```gherkin
Scenario: Solid is a property of a shape
  Given a CollisionShape3D is selected
  Then the Inspector has a Solid checkbox, off for a new shape
  And turning it on is one undo step, is saved with the project, and colors the shape differently in the viewport

Scenario: Falling onto a floor
  Given a body with a shape above a solid box, and a script that moves it down every frame
  When it has fallen
  Then it rests on top of the box (a hair above it), is_on_floor() is true, and it does not sink or jitter

Scenario: Walking off an edge
  Given a body standing near the edge of a solid box
  When it is moved sideways past the edge
  Then is_on_floor() becomes false and it falls

Scenario: Walls stop a walk and let it slide
  Given a solid wall
  When the body is moved into the wall
  Then it stops at the wall and is_on_wall() is true
  And moving diagonally into the wall slides along it

Scenario: Ceilings stop a jump
  Given a solid shape above the body
  When the body is moved up into it
  Then it stops under it and is_on_ceiling() is true

Scenario: Fast bodies do not pass through thin floors
  Given a thin solid floor
  When a body is moved down 5 units in one call
  Then it lands on the floor

Scenario: A body that starts inside a solid shape can get out
  Given a body overlapping a solid shape
  When it is moved by a step big enough to end clear of it
  Then it moves there (it is not held by what it is already in)

Scenario: What is not solid, hidden or the body's own does not stop it
  Given a shape that is not Solid, a hidden solid shape, and a body's own solid shape
  Then none of them blocks the body

Scenario: A body needs a shape
  When a script calls move_and_collide on a node with no collision shape under it
  Then it is an error saying so

Scenario: A whole game
  Given a level of solid boxes built in the editor and the example player script
  When the game runs on the emulator and the D-pad and A are used
  Then the player walks, jumps, lands on platforms and is stopped by walls
```

## Notes (built and verified)
- **Data and editor:** `collision.solid` (core `collision-shape.ts`, the schema, `SET_COLLISION_SHAPE`), the **Solid** checkbox in `CollisionShapeField.tsx`, and a warm
  color for solid shapes in the viewport (`Viewport3D.tsx`). **Language:** `move_and_collide(dx, dy, dz)`, `is_on_floor()`, `is_on_wall()`, `is_on_ceiling()` in the
  checker (`checkBodyCall`, `requireBody`; the error names the node that has no shape under it), and the code generator. **Compiler:** the `solid` flag in `DsCollider` and
  `GsCollider`; `collision-shape-unused` now says a solid shape "stops nothing" when no script moves a body, and a body's own shapes and every solid shape count as used
  once a script calls `move_and_collide`. **Runtime:** `gs_move_and_collide` and `gs_body_state` in `runtime/source/gs_collision.c`.
- **How a move works:** the body's `position` is moved one axis at a time (Y, X, Z) in steps of at most a quarter of a unit; a step that would end overlapping a solid shape is
  bisected (6 rounds) to the furthest place it can go and then pulled back by the 0.01-unit skin; a step no longer than the skin that is blocked is refused at once (this is a
  body resting on something). Only the body's own transform is recomputed for each try (its shapes are shifted by how far it moved); the rest of its subtree is brought up to
  date once at the end.
- **Speed** (found by measuring on the DS, not by reading): the first version took 6.7 ms to stand still, 7.7 ms to walk and 19 ms to press against a wall, per call, which is
  a whole frame. Refusing a blocked step no longer than the skin at once, shifting the shapes instead of recomputing the subtree, fewer bisection rounds, and an exact test for
  two boxes that line up with the axes (no search at all: compare centers with the sum of half extents; `aligned_box` in `gs_shapes_overlap`, agreeing with the oracle on the
  random pairs) brought it to **0.57 to 0.87 ms per call** in the tests (one body shape against eight solid shapes).
- **Verified on the DS:** `collision-body.rom.test.ts` (29): falling onto a floor and resting without sinking or jitter, a 6-unit fall in one call landing on a floor 0.1 thick,
  walking, walls stopping a walk and a 5-unit sideways move, sliding along a wall, walking off an edge and falling, a ceiling stopping a rise, hidden, not-solid and the body's
  own solid shapes not stopping it, a body inside a solid getting out, and the cost. `player-script.rom.test.ts` (22): the example player script in a level with a floor, a step, a
  wall and a low ceiling (walk speed, a jump's height and length, no double jump, landing on the step by jumping onto it, the ceiling bumping the head). The overlap suites
  (`collision.rom.test.ts` with 3x the random pairs, `collision-scene.rom.test.ts`) still pass with the fast path in.
- **Through the editor:** `tests/prototypes/e2e/platformer.mjs` (4 checks) builds a level with a solid floor and wall, a player and the example script through the UI, and
  `GSDS_PLATFORMER_ROM_PROJECT=<path> pnpm test:rom` runs it in melonDS: the player falls onto the floor and stands (silhouette overlap 0.958 with the right picture against 0.854
  for still floating) and with Right held stops at the wall (0.967 against 0.908 for passing through it).
- **Known limits:** near-touching is decided as for `overlaps()` (within a hair), plus the 0.01 skin; a body that is pushed into a solid by a *moving* solid shape is not pushed out
  (no moving platforms carry the player either); movement is in the body's own `position` axes (with a rotated parent it is that node's local axes); at most as many bodies per
  frame as the frame's time allows (about 0.6 to 0.9 ms each); no slopes or stairs step-up; no `is_on_*` for `overlaps()` shapes.
