/*
 * Collision shapes: do two of them overlap? (requirements/collision/TASK.compile-and-run-collision-checks.md)
 *
 * A shape is a box, sphere, capsule or cylinder (the compiler's `DsCollider`), placed in the world by a node's rotation, per-axis scale and
 * position. `gs_shapes_overlap` takes two explicit placed shapes so a test can drive it with any input; `gs_overlaps` (gs_api.h) looks them up
 * from the node table.
 *
 * Numbers are the DS's 20.12 fixed point (a `float` of a script), 32 bits, held in 64 bits while they are being worked with.
 */
#ifndef GS_COLLISION_H
#define GS_COLLISION_H

#include <stdint.h>

/* What a `GsCollider.shape` (scene.h) is. */
#define GS_SHAPE_BOX      0
#define GS_SHAPE_SPHERE   1
#define GS_SHAPE_CAPSULE  2
#define GS_SHAPE_CYLINDER 3
/* A convex hull: its own points (`hull`, `hullCount` of them), each the shape's own point farthest in some direction (its "support" is a lookup, not
   a formula, unlike the other three). Wraps a mesh (requirements/collision/STORY.collision-polygon-wraps-mesh.md); `p[0]` is its bounding radius, so
   it can be bounded exactly like a sphere without looking at `hull` at all (bound_radius, spread_of). */
#define GS_SHAPE_HULL     4

/*
 * A shape, placed. `p` is the shape's own size, before scale:
 *   box       half extents x, y, z
 *   sphere    radius, unused, unused
 *   capsule   radius, half the straight part's length (the height less the two round ends, halved), unused; standing along Y
 *   cylinder  radius, half the height, unused; standing along Y
 *   hull      bounding radius, unused, unused
 * The shape is centered on the node and turned by `rotation` (row-major: rotation[row][col]), each local axis is stretched by `scale`, then
 * `center` is added. A sphere with an uneven scale is an ellipsoid. `hull`/`hullCount` (GS_SHAPE_HULL only) are the shape's own points in its own
 * local space, before scale: flat, 3 int32 (x, y, z) per point.
 */
typedef struct {
	uint8_t shape;
	int32_t p[3];
	int32_t rotation[3][3];
	int32_t scale[3];
	int32_t center[3];
	const int32_t *hull;
	int hullCount;
} GsShapeInst;

/* True when the two shapes share a point (or are within a hair of touching). */
int gs_shapes_overlap(const GsShapeInst *a, const GsShapeInst *b);

/* How many rounds of the search the last `gs_shapes_overlap` took (0 when the bounding spheres settled it): a test hook, not something to rely on. */
extern uint32_t gs_collision_iterations;

#endif
