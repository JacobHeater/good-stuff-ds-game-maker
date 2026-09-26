---
status: done
component: collision
related: [STORY.solid-shapes-and-move-and-collide.md]
---

# Story: Ray casts

## Context
Shooting, line of sight, and "what is in front of me" all need to ask how far it is along a line to the nearest solid thing. Third step of making the engine good enough for a full 3D game (with `overlaps()` polling as
the trigger area, and `probe_solid` for footing, this is the collision toolbox; collision layers and enter/exit events are not built).

## Decisions (owner delegated; say if any is wrong)
- **`body.ray_cast(ox, oy, oz, dx, dy, dz, max) -> float`** (or `ray_cast(...)` on the script's own node). The ray starts at world position (ox, oy, oz), goes toward (dx, dy, dz) (any length; it is normalized), and the answer is how far
  along it the nearest **visible solid** shape is, or **-1.0** if nothing is within `max`. The body's own shapes are ignored, so a character can cast from inside itself. Non-solid shapes (trigger areas) and hidden shapes don't count.
  A ray that starts inside a solid shape gets 0.
- **Exact for boxes**, and within 0.03 units for spheres, capsules and cylinders (found by stepping a tiny sphere along the ray). It tells you how far, not what was hit.
- Like `probe_solid`, it uses the shapes as they were placed at the start of the frame (a shape shown or moved this frame counts from the next). It costs about 0.8 ms against 60 solid shapes on the DS.
- Trigger areas stay `overlaps()` (a non-solid CollisionShape3D) polled each frame; a script can keep a variable for enter/exit. **Not built:** collision layers and masks, enter/exit events, telling which shape a ray hit.

## Notes (built and verified)
- Checker (`ray_cast`, `rayCall`), completion, codegen (`gs_ray_cast`), runtime (`gs_collision.c`: `ray_vs_box`, `ray_vs_shape`, a cheap reject per shape).
- Unit tests: `core/src/script/script-ray.test.ts`. On the DS (emulator): 13 cases in `testing/collision-body.rom.test.ts` (down through the body's own shape, sideways, non-unit direction, max, a slant, over a wall, hidden, non-solid, starting inside, a sphere, a capsule, nearest of several) plus timings.
