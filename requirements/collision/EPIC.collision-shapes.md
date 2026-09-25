---
status: done
component: collision
related: [STORY.collision-shapes-and-overlap-checks.md, STORY.solid-shapes-and-move-and-collide.md, TASK.collision-shape-model-and-persistence.md, TASK.collision-shape-inspector-and-viewport.md, TASK.script-overlaps-check.md, TASK.compile-and-run-collision-checks.md, scripting/EPIC.scripting.md, compiler/EPIC.compile-and-export-nds-rom.md, scene-designer/EPIC.scene-designer.md]
---

# Epic: Collision shapes

## Context
A `CollisionShape3D` node has been in the Add Node menu since the start, but it was only a name: it had no shape, nothing drew it, and
the compiler ignored it ("ignored by design"). Scripting (`scripting/EPIC.scripting.md`) can now move and show nodes, but a script has
no way to ask whether two things are touching, so a game can't yet react to a coin being picked up or a wall being hit.

## Narrative
Godot gives a scene collision shapes you can see and size in the editor, and physics that answers "are these touching?". The DS has no
physics library, so the first slice keeps to the part a small game needs most and that can be checked exactly: **shapes you edit and see
in the viewport, compiled into the ROM, and a script call that asks whether two shapes overlap**. What happens next (stop, bounce, score)
is the script's decision.

The first slice (`STORY.collision-shapes-and-overlap-checks.md`) is delivered by:
- the shape data on the node and its place in the project file (`TASK.collision-shape-model-and-persistence.md`);
- editing it in the Inspector and seeing it as a wireframe in the 3D viewport (`TASK.collision-shape-inspector-and-viewport.md`);
- the `overlaps()` call in the script language (`TASK.script-overlaps-check.md`);
- putting the shapes in the ROM and testing overlap on the DS (`TASK.compile-and-run-collision-checks.md`).

Ground, walls and ceilings came next (`STORY.solid-shapes-and-move-and-collide.md`): solid shapes stop a body a script moves with `move_and_collide`.

Still out (each a future ticket): full physics (bodies that bounce, slopes, moving platforms that carry things), knowing
*where* or how deeply two shapes touch (contact point, push-out direction), ray casts, layers and masks, `Area3D`-style enter/exit events,
convex-hull and triangle-mesh shapes, and 2D collision (`CollisionShape2D`, which still does nothing).

## Acceptance Criteria (narrative)
The Epic is done when a user can add a collision shape to a node, size it while looking at it in the viewport, write
`if $Player.overlaps($Coin):` in a script, export a ROM, and watch the game react on the emulator exactly when the shapes touch.

## Outcome
The first slice is built and verified: `CollisionShape3D` has a shape (box, sphere, capsule or cylinder) and size, drawn as a wireframe in the viewport, saved in
the project, compiled into the ROM, and scripts ask `a.overlaps(b)`. The overlap test is exact for every pair of shapes (within a hair of touching) and was checked
on the DS against an independent method on about 5 000 random pairs. It costs about half a millisecond a check.

## Update: solid shapes
`STORY.solid-shapes-and-move-and-collide.md` added a **Solid** setting and `move_and_collide()`/`is_on_floor()`/`is_on_wall()`/`is_on_ceiling()`: a body (a node with shapes under
it) is stopped by solid shapes, so a platformer's player lands on real ground. The example player script uses it.
