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

/*
 * A shape, placed. `p` is the shape's own size, before scale:
 *   box       half extents x, y, z
 *   sphere    radius, unused, unused
 *   capsule   radius, half the straight part's length (the height less the two round ends, halved), unused; standing along Y
 *   cylinder  radius, half the height, unused; standing along Y
 * The shape is centered on the node and turned by `rotation` (row-major: rotation[row][col]), each local axis is stretched by `scale`, then
 * `center` is added. A sphere with an uneven scale is an ellipsoid.
 */
typedef struct {
	uint8_t shape;
	int32_t p[3];
	int32_t rotation[3][3];
	int32_t scale[3];
	int32_t center[3];
} GsShapeInst;

/* True when the two shapes share a point (or are within a hair of touching). */
int gs_shapes_overlap(const GsShapeInst *a, const GsShapeInst *b);

/* How many rounds of the search the last `gs_shapes_overlap` took (0 when the bounding spheres settled it): a test hook, not something to rely on. */
extern uint32_t gs_collision_iterations;

#endif
