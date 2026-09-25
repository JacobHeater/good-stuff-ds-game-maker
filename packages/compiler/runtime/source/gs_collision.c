/*
 * Do two collision shapes overlap? Requirements: requirements/collision/TASK.compile-and-run-collision-checks.md
 *
 * Each shape is a box, sphere, capsule or cylinder turned, stretched (per axis) and moved by its node: an affine image of a convex shape, so
 * it has a "support point" (the point of it farthest in a direction) that is cheap to find. The test is GJK, the standard method for convex
 * shapes: it looks for the point of the "difference" of the two shapes (every point of one minus every point of the other) that is nearest
 * the origin. The shapes overlap exactly when that difference contains the origin. This is the distance form of GJK (closest point of a small
 * simplex, repeated), which copes with the exact ties that boxes on a grid produce far better than the sign-test form.
 *
 * The DS has no floating point hardware, so the arithmetic is 20.12 fixed point held in 64 bits. GJK's own numbers are scaled down to a fixed
 * working size first (`WORK_BITS`), so that the products in it can't overflow; a pair of shapes that far apart is rejected earlier by a
 * bounding sphere test.
 */
#include <nds.h>
#include <stdint.h>
#include <stdlib.h>

#include "gs_api.h"
#include "gs_collision.h"
#include "gs_runtime.h"
#include "scene.h"

typedef int64_t i64;
typedef uint64_t u64;
typedef struct { i64 x, y, z; } V;

static inline V mk(i64 x, i64 y, i64 z) { V r = { x, y, z }; return r; }
static inline V vadd(V a, V b) { return mk(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline V vsub(V a, V b) { return mk(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline V vneg(V a) { return mk(-a.x, -a.y, -a.z); }
static inline i64 vdot(V a, V b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline V vcross(V a, V b) { return mk(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static inline V vshr(V a, int s) { return mk(a.x >> s, a.y >> s, a.z >> s); }
static inline i64 iabs(i64 a) { return a < 0 ? -a : a; }

/* The square root of a 64-bit number (below 2^63), on the DS's square root unit. */
static inline u64 isqrt64(u64 n) { return (u64)sqrt64((long long)n); }

/* The number of bits a value needs. */
static inline int bitlen(u64 v) {
	uint32_t high = (uint32_t)(v >> 32), low = (uint32_t)v;
	if (high) return 64 - __builtin_clz(high);
	return low ? 32 - __builtin_clz(low) : 0;
}

/* x * num / den for 0 <= num <= den, on the DS's divider: both are first shifted down until the denominator fits in 31 bits. */
static i64 mul_frac(i64 x, i64 num, i64 den) {
	while (den >= ((i64)1 << 31)) {
		num >>= 1;
		den >>= 1;
	}
	if (den <= 0) return 0;
	return div64(x * num, (s32)den);
}

/* A direction, scaled so its largest component is about 2^24: only its direction matters, and this keeps it precise without overflowing. */
static V unit_direction(V d) {
	i64 m = iabs(d.x);
	if (iabs(d.y) > m) m = iabs(d.y);
	if (iabs(d.z) > m) m = iabs(d.z);
	if (m == 0) return d;
	int shift = bitlen((u64)m) - 24;
	if (shift > 0) return vshr(d, shift);
	if (shift < 0) return mk(d.x << -shift, d.y << -shift, d.z << -shift);
	return d;
}

/* ---- Shapes ---------------------------------------------------------------------------------------------------------------------- */

/* The point of the round part of a shape farthest along `dl`: radius r along the unit direction of dl. */
static V radial3(V dl, i64 r) {
	i64 len = (i64)isqrt64((u64)vdot(dl, dl));
	if (len == 0) return mk(r, 0, 0);
	return mk(div64(dl.x * r, (s32)len), div64(dl.y * r, (s32)len), div64(dl.z * r, (s32)len));
}

/* The point of the shape (in its own space, unscaled and unturned) farthest along `dl`. */
static V local_support(const GsShapeInst *s, V dl) {
	switch (s->shape) {
	case GS_SHAPE_BOX:
		return mk(dl.x >= 0 ? s->p[0] : -(i64)s->p[0], dl.y >= 0 ? s->p[1] : -(i64)s->p[1], dl.z >= 0 ? s->p[2] : -(i64)s->p[2]);
	case GS_SHAPE_SPHERE:
		return radial3(dl, s->p[0]);
	case GS_SHAPE_CAPSULE: {
		V p = radial3(dl, s->p[0]); /* a sphere swept along a segment: the sphere's point plus the segment's end */
		p.y += dl.y >= 0 ? s->p[1] : -(i64)s->p[1];
		return p;
	}
	default: { /* cylinder */
		i64 len = (i64)isqrt64((u64)(dl.x * dl.x + dl.z * dl.z));
		V p = mk(0, dl.y >= 0 ? s->p[1] : -(i64)s->p[1], 0);
		if (len != 0) {
			p.x = div64(dl.x * s->p[0], (s32)len);
			p.z = div64(dl.z * s->p[0], (s32)len);
		}
		return p;
	}
	}
}

/*
 * The point of the placed shape farthest along the world direction `d`, relative to the shape's center. The shape is `R * (S * p)` for a point p
 * of the basic shape, and (R S p) . d = p . (S R^T d), so the farthest point is found in the shape's own space along S R^T d.
 */
static V support_world(const GsShapeInst *s, V d) {
	V t = mk(((i64)s->rotation[0][0] * d.x + (i64)s->rotation[1][0] * d.y + (i64)s->rotation[2][0] * d.z) >> 12,
	         ((i64)s->rotation[0][1] * d.x + (i64)s->rotation[1][1] * d.y + (i64)s->rotation[2][1] * d.z) >> 12,
	         ((i64)s->rotation[0][2] * d.x + (i64)s->rotation[1][2] * d.y + (i64)s->rotation[2][2] * d.z) >> 12);
	V dl = unit_direction(mk((t.x * s->scale[0]) >> 12, (t.y * s->scale[1]) >> 12, (t.z * s->scale[2]) >> 12));
	V p = local_support(s, dl);
	V q = mk((p.x * s->scale[0]) >> 12, (p.y * s->scale[1]) >> 12, (p.z * s->scale[2]) >> 12);
	return mk(((i64)s->rotation[0][0] * q.x + (i64)s->rotation[0][1] * q.y + (i64)s->rotation[0][2] * q.z) >> 12,
	          ((i64)s->rotation[1][0] * q.x + (i64)s->rotation[1][1] * q.y + (i64)s->rotation[1][2] * q.z) >> 12,
	          ((i64)s->rotation[2][0] * q.x + (i64)s->rotation[2][1] * q.y + (i64)s->rotation[2][2] * q.z) >> 12);
}

/* A sphere around the shape's center that holds all of it (no smaller than it needs to be for the shape's own extent, so never too small). */
static u64 bound_radius(const GsShapeInst *s) {
	u64 sx = (u64)iabs(s->scale[0]), sy = (u64)iabs(s->scale[1]), sz = (u64)iabs(s->scale[2]);
	u64 smax = sx > sy ? (sx > sz ? sx : sz) : (sy > sz ? sy : sz);
	switch (s->shape) {
	case GS_SHAPE_BOX: {
		u64 x = ((u64)s->p[0] * sx) >> 12, y = ((u64)s->p[1] * sy) >> 12, z = ((u64)s->p[2] * sz) >> 12;
		return isqrt64(x * x + y * y + z * z) + 1;
	}
	case GS_SHAPE_SPHERE:
		return (((u64)s->p[0] * smax) >> 12) + 1;
	case GS_SHAPE_CAPSULE:
		return ((((u64)s->p[1] * sy) >> 12) + (((u64)s->p[0] * smax) >> 12)) + 1;
	default: {
		u64 r = ((u64)s->p[0] * (sx > sz ? sx : sz)) >> 12, h = ((u64)s->p[1] * sy) >> 12;
		return isqrt64(r * r + h * h) + 1;
	}
	}
}

/* ---- The closest point of a simplex to the origin --------------------------------------------------------------------------------- */

/* Working coordinates are at most about 2^WORK_BITS, so every product below fits in 64 bits. */
#define WORK_BITS 15
/* A closest point this near the origin (squared, in working units) means the shapes touch: two working units. */
#define TOUCH2 4

/* The closest point of segment ab to the origin, and which ends make it up (bit 0 = a, bit 1 = b). */
static V closest_seg(V a, V b, int *mask) {
	V ab = vsub(b, a);
	i64 num = -vdot(a, ab);
	if (num <= 0) {
		*mask = 1;
		return a;
	}
	i64 den = vdot(ab, ab);
	if (num >= den) {
		*mask = 2;
		return b;
	}
	*mask = 3;
	return vadd(a, mk(mul_frac(ab.x, num, den), mul_frac(ab.y, num, den), mul_frac(ab.z, num, den)));
}

/* x / y as a 30-bit fraction (x / y * 2^30), for 0 <= x <= y: both are first shifted down until y fits in 31 bits. */
static i64 frac30(i64 x, i64 y) {
	while (y >= ((i64)1 << 31)) {
		x >>= 1;
		y >>= 1;
	}
	if (y <= 0) return 0;
	return div64(x << 30, (s32)y);
}

/* Products of two dot products are formed from values shifted down by this much, so they fit in 64 bits (only the sign, near zero, is affected). */
#define DOT_SHIFT 4

/* The closest point of triangle abc to the origin, and which corners make it up (bits 0, 1, 2). */
static V closest_tri(V a, V b, V c, int *mask) {
	V ab = vsub(b, a), ac = vsub(c, a);
	i64 d1 = -vdot(ab, a), d2 = -vdot(ac, a);
	if (d1 <= 0 && d2 <= 0) {
		*mask = 1;
		return a;
	}
	i64 d3 = -vdot(ab, b), d4 = -vdot(ac, b);
	if (d3 >= 0 && d4 <= d3) {
		*mask = 2;
		return b;
	}
	i64 vc = (d1 >> DOT_SHIFT) * (d4 >> DOT_SHIFT) - (d3 >> DOT_SHIFT) * (d2 >> DOT_SHIFT);
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		i64 den = d1 - d3;
		if (den == 0) {
			*mask = 1;
			return a;
		}
		*mask = 3;
		return vadd(a, mk(mul_frac(ab.x, d1, den), mul_frac(ab.y, d1, den), mul_frac(ab.z, d1, den)));
	}
	i64 d5 = -vdot(ab, c), d6 = -vdot(ac, c);
	if (d6 >= 0 && d5 <= d6) {
		*mask = 4;
		return c;
	}
	i64 vb = (d5 >> DOT_SHIFT) * (d2 >> DOT_SHIFT) - (d1 >> DOT_SHIFT) * (d6 >> DOT_SHIFT);
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		i64 den = d2 - d6;
		if (den == 0) {
			*mask = 1;
			return a;
		}
		*mask = 5;
		return vadd(a, mk(mul_frac(ac.x, d2, den), mul_frac(ac.y, d2, den), mul_frac(ac.z, d2, den)));
	}
	i64 va = (d3 >> DOT_SHIFT) * (d6 >> DOT_SHIFT) - (d5 >> DOT_SHIFT) * (d4 >> DOT_SHIFT);
	if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
		i64 den = (d4 - d3) + (d5 - d6);
		if (den == 0) {
			*mask = 2;
			return b;
		}
		V bc = vsub(c, b);
		i64 num = d4 - d3;
		*mask = 6;
		return vadd(b, mk(mul_frac(bc.x, num, den), mul_frac(bc.y, num, den), mul_frac(bc.z, num, den)));
	}
	/* Inside the triangle: a + ab * v + ac * w with the weights v = vb / denom and w = vc / denom. */
	i64 denom = va + vb + vc;
	if (denom <= 0) {
		/* A flat (all in a line) triangle: its closest point is on one of its edges. */
		int m1, m2, m3;
		V q1 = closest_seg(a, b, &m1), q2 = closest_seg(b, c, &m2), q3 = closest_seg(a, c, &m3);
		i64 e1 = vdot(q1, q1), e2 = vdot(q2, q2), e3 = vdot(q3, q3);
		if (e1 <= e2 && e1 <= e3) {
			*mask = m1;
			return q1;
		}
		if (e2 <= e3) {
			*mask = (m2 & 1) << 1 | (m2 & 2) << 1;
			return q2;
		}
		*mask = (m3 & 1) | (m3 & 2) << 1;
		return q3;
	}
	i64 wv = vb <= 0 ? 0 : frac30(vb, denom), ww = vc <= 0 ? 0 : frac30(vc, denom);
	if (wv + ww > ((i64)1 << 30)) ww = ((i64)1 << 30) - wv;
	*mask = 7;
	return vadd(a, mk((ab.x * wv + ac.x * ww) >> 30, (ab.y * wv + ac.y * ww) >> 30, (ab.z * wv + ac.z * ww) >> 30));
}

/* Whether the origin is inside the tetrahedron; if not, the closest point of its surface and which corners make it up. */
static int closest_tetra(const V *p, V *q, int *mask) {
	static const int faces[4][4] = { { 0, 1, 2, 3 }, { 0, 2, 3, 1 }, { 0, 3, 1, 2 }, { 1, 3, 2, 0 } };
	int any = 0;
	i64 best = 0;
	for (int f = 0; f < 4; f++) {
		V a = p[faces[f][0]], b = p[faces[f][1]], c = p[faces[f][2]], opposite = p[faces[f][3]];
		V n = vcross(vsub(b, a), vsub(c, a));
		i64 side = vdot(n, vsub(opposite, a)); /* which side of the face the fourth corner is on */
		i64 origin = -vdot(n, a);              /* and the origin */
		/* Outside this face when the origin is on the other side from the fourth corner; a flat tetrahedron (side 0) has no inside. */
		int outside = side == 0 || (side > 0 && origin < 0) || (side < 0 && origin > 0);
		if (!outside) continue;
		int m;
		V point = closest_tri(a, b, c, &m);
		i64 d2 = vdot(point, point);
		if (!any || d2 < best) {
			any = 1;
			best = d2;
			*q = point;
			int remapped = 0;
			for (int bit = 0; bit < 3; bit++)
				if (m & (1 << bit)) remapped |= 1 << faces[f][bit];
			*mask = remapped;
		}
	}
	return !any;
}

/*
 * Replaces the simplex (n points) by the smallest set of them whose closest point to the origin is the same as the whole simplex's, and
 * returns that closest point in `v`, and in `d` the direction to search next: from the simplex toward the origin, square to it. Returns 1 when
 * the simplex has four points and holds the origin.
 *
 * `d` is worked out from the simplex's points, not from `v`. `v` is only known to a working unit or so, and when it is a few units long that
 * is a direction that can be tens of degrees out; the point search along a wrong direction returns is one that does not help, and the search
 * can go round in circles. The edges and the face normal of the simplex are exact.
 */
static int reduce(V *s, int *n, V *v, V *d) {
	int mask = 0;
	switch (*n) {
	case 1:
		*v = s[0];
		*d = vneg(s[0]);
		return 0;
	case 2:
		*v = closest_seg(s[0], s[1], &mask);
		break;
	case 3:
		*v = closest_tri(s[0], s[1], s[2], &mask);
		break;
	default:
		if (closest_tetra(s, v, &mask)) return 1;
		break;
	}
	int kept = 0;
	for (int i = 0; i < *n; i++)
		if (mask & (1 << i)) s[kept++] = s[i];
	*n = kept;

	*d = vneg(*v); /* the fallback, and right for a single point */
	if (kept == 2) {
		/* Square to the edge, toward the origin: (ab x ao) x ab. */
		V ab = vsub(s[1], s[0]);
		V along = vcross(vcross(ab, vneg(s[0])), ab);
		if (along.x != 0 || along.y != 0 || along.z != 0) *d = along;
	} else if (kept == 3) {
		/* The face's normal, on the side the origin is. */
		V normal = vcross(vsub(s[1], s[0]), vsub(s[2], s[0]));
		if (normal.x != 0 || normal.y != 0 || normal.z != 0) *d = vdot(normal, s[0]) <= 0 ? normal : vneg(normal);
	}
	return 0;
}

/* ---- GJK ------------------------------------------------------------------------------------------------------------------------- */

#define MAX_ITERATIONS 64

/* How many rounds the last check took (for tests that watch the speed). */
uint32_t gs_collision_iterations;

/*
 * A box that is not turned (or turned only by quarter turns) lines up with the axes, and two such boxes overlap exactly when their centers are
 * closer than the sum of their half extents on every axis: no search needed. Levels are mostly made of these. `half` gets the box's half extents along
 * the world axes; returns 0 for any other shape or rotation.
 */
static int aligned_box(const GsShapeInst *s, i64 half[3]) {
	if (s->shape != GS_SHAPE_BOX) return 0;
	int used = 0;
	for (int row = 0; row < 3; row++) {
		int found = -1;
		for (int col = 0; col < 3; col++) {
			int32_t r = s->rotation[row][col];
			if (r == 0) continue;
			if ((r != GS_ONE && r != -GS_ONE) || found >= 0) return 0;
			found = col;
		}
		if (found < 0 || (used & (1 << found))) return 0;
		used |= 1 << found;
		half[row] = ((i64)s->p[found] * iabs(s->scale[found])) >> 12;
	}
	return 1;
}

int gs_shapes_overlap(const GsShapeInst *a, const GsShapeInst *b) {
	gs_collision_iterations = 0;
	{
		i64 ha[3], hb[3];
		if (aligned_box(a, ha) && aligned_box(b, hb)) {
			for (int i = 0; i < 3; i++) {
				if (iabs((i64)b->center[i] - a->center[i]) > ha[i] + hb[i]) return 0;
			}
			return 1;
		}
	}
	V rel = mk((i64)b->center[0] - a->center[0], (i64)b->center[1] - a->center[1], (i64)b->center[2] - a->center[2]);
	u64 sum = bound_radius(a) + bound_radius(b);
	if (sum > 0x7fffffffu) sum = 0x7fffffffu;
	/* Bounding spheres apart: the shapes are. (Each axis first, so the squares below can't overflow.) */
	if ((u64)iabs(rel.x) > sum || (u64)iabs(rel.y) > sum || (u64)iabs(rel.z) > sum) return 0;
	if ((u64)vdot(rel, rel) > sum * sum) return 0;

	/* Points of the difference are at most about twice `sum` from the origin; scale them to the working size. */
	int shift = bitlen(2 * sum) - WORK_BITS;
	if (shift < 0) shift = 0;

	V s[4];
	int n = 1;
	V dir = unit_direction(rel.x == 0 && rel.y == 0 && rel.z == 0 ? mk(1, 0, 0) : rel);
	s[0] = vshr(vsub(support_world(a, dir), vadd(support_world(b, vneg(dir)), rel)), shift);
	V v = s[0];
	V d = vneg(v);
	i64 last = 0;
	int stalled = 0;

	for (int iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		gs_collision_iterations = (uint32_t)iteration + 1;
		i64 vv = vdot(v, v);
		if (vv <= TOUCH2) return 1;
		/* Rounding can leave the closest point where it was; after a few rounds of that there is nothing more to learn at this precision. */
		if (iteration > 0 && vv >= last) {
			if (++stalled >= 4) return vv <= 16 * TOUCH2;
		} else {
			stalled = 0;
		}
		last = vv;

		/* The point of the difference farthest toward the origin, along the direction the simplex faces. */
		V du = unit_direction(d);
		V w = vshr(vsub(support_world(a, du), vadd(support_world(b, vneg(du)), rel)), shift);
		i64 reach = vdot(du, w);
		if (reach < 0) return 0; /* the whole difference is on the near side of a plane through the origin: it isn't in it */
		/* How far past the simplex's own plane that point is, in working units. If it is hardly any, the simplex is on the difference's edge. */
		i64 length = (i64)isqrt64((u64)vdot(du, du));
		i64 progress = length == 0 ? 0 : (reach - vdot(du, s[0])) / length;
		if (progress <= 1 + ((i64)isqrt64((u64)vv) >> 9)) return 0;
		for (int i = 0; i < n; i++)
			if (s[i].x == w.x && s[i].y == w.y && s[i].z == w.z) return 0;
		s[n++] = w;
		if (reduce(s, &n, &v, &d)) return 1;
	}
	return vdot(v, v) <= 16 * TOUCH2;
}

/* ---- Shapes of nodes ------------------------------------------------------------------------------------------------------------- */

/* The placed shape of a node's collider from the transforms as they are now, or 0 when the node has no shape or isn't visible. */
static int shape_placed(int node, GsShapeInst *out) {
	if (node < 0 || node >= gs_scene.nodeCount) return 0;
	const GsNode *n = &gs_scene.nodes[node];
	if (n->collider < 0) return 0;
	if (!gs_world_visible[node]) return 0;
	const GsCollider *c = &gs_scene.colliders[n->collider];
	out->shape = c->shape;
	for (int i = 0; i < 3; i++) {
		out->p[i] = c->p[i];
		out->scale[i] = gs_world_scale[node][i];
		out->center[i] = gs_world_matrix[node].m[12 + i];
	}
	for (int row = 0; row < 3; row++)
		for (int col = 0; col < 3; col++) out->rotation[row][col] = gs_world_matrix[node].m[col * 4 + row];
	return 1;
}

/* The same, after bringing the node (and its parents) up to date with what scripts have written so far this frame. */
static int shape_of_node(int node, GsShapeInst *out) {
	if (node < 0 || node >= gs_scene.nodeCount || gs_scene.nodes[node].collider < 0) return 0;
	gs_refresh_node(node);
	return shape_placed(node, out);
}

int gs_overlaps(int a, int b) {
	GsShapeInst first, second;
	if (!shape_of_node(a, &first) || !shape_of_node(b, &second)) return 0;
	return gs_shapes_overlap(&first, &second);
}

/* ---- Bodies ---------------------------------------------------------------------------------------------------------------------- */

/* A move is taken in steps no longer than a quarter of a unit, so a fast body doesn't pass through a thin floor. */
#define MOVE_STEP (GS_ONE / 4)
/* A body stops this far (0.01 units) short of what it hits: the overlap test counts touching as overlapping, and a body resting exactly on the
   floor would then be unable to slide along it. */
#define SKIN 41
/* Rounds of halving to find where in a step the body meets something: the step's length / 64, under the skin for a step of a quarter of a unit. */
#define BISECTIONS 6

static uint8_t *body_flags;   /* per node: what its last move ran into */
static GsShapeInst *solids;   /* the solid shapes for the move being made */
static int *body_shapes;      /* the node indices of the body's shapes */

typedef struct {
	int body;
	int shapeCount;
	int solidCount;
} MoveContext;

static int node_under(int node, int root) {
	for (int i = node; i >= 0; i = gs_scene.nodes[i].parent) {
		if (i == root) return 1;
	}
	return 0;
}

/* Whether any of the body's shapes overlaps any solid shape, with the transforms as they now are. */
static int body_hits(const MoveContext *ctx) {
	for (int i = 0; i < ctx->shapeCount; i++) {
		GsShapeInst inst;
		if (!shape_placed(body_shapes[i], &inst)) continue;
		for (int k = 0; k < ctx->solidCount; k++) {
			if (gs_shapes_overlap(&inst, &solids[k])) return 1;
		}
	}
	return 0;
}

/*
 * Puts the body at `position` along `axis`. Only the body's own transform is recomputed: everything under it keeps its rotation and scale, so its
 * shapes just shift by however far the body's world position moved. (The rest of the body's subtree is brought up to date once, at the end of the move.)
 */
static void place_body(const MoveContext *ctx, int axis, int32_t position) {
	int32_t *world = gs_world_matrix[ctx->body].m;
	int32_t before[3] = { world[12], world[13], world[14] };
	gs_node_state[ctx->body].position[axis] = position;
	gs_recompute_node(ctx->body);
	int32_t moved[3] = { world[12] - before[0], world[13] - before[1], world[14] - before[2] };
	for (int i = 0; i < ctx->shapeCount; i++) {
		if (body_shapes[i] == ctx->body) continue;
		int32_t *m = gs_world_matrix[body_shapes[i]].m;
		m[12] += moved[0];
		m[13] += moved[1];
		m[14] += moved[2];
	}
}

/* Moves the body along `axis` by up to `step` (at most MOVE_STEP long), returns how far it got. */
static int32_t move_step(const MoveContext *ctx, int axis, int32_t step) {
	int32_t base = gs_node_state[ctx->body].position[axis];
	place_body(ctx, axis, base + step);
	if (!body_hits(ctx)) return step;
	place_body(ctx, axis, base);
	/* A step no longer than the gap left short of what it hits can't get anywhere: this is a body resting against something. */
	if (step <= SKIN && step >= -SKIN) return 0;
	/* A body that is already inside a solid shape isn't stopped by it: it moves freely until it is out (so it can always get out). */
	if (body_hits(ctx)) {
		place_body(ctx, axis, base + step);
		return step;
	}
	/* Free where it is and blocked where it would go: find the furthest it gets. */
	int32_t free = 0, blocked = step;
	for (int i = 0; i < BISECTIONS; i++) {
		int32_t middle = (free + blocked) / 2;
		place_body(ctx, axis, base + middle);
		if (body_hits(ctx)) blocked = middle;
		else free = middle;
	}
	int32_t got = free;
	if (got > SKIN) got -= SKIN;
	else if (got < -SKIN) got += SKIN;
	else got = 0;
	place_body(ctx, axis, base + got);
	return got;
}

int gs_move_and_collide(int body, int32_t dx, int32_t dy, int32_t dz) {
	if (body < 0 || body >= gs_scene.nodeCount) return 0;
	if (!body_flags) {
		body_flags = calloc(gs_scene.nodeCount, 1);
		solids = malloc(sizeof(GsShapeInst) * (gs_scene.colliderCount + 1));
		body_shapes = malloc(sizeof(int) * (gs_scene.colliderCount + 1));
	}
	body_flags[body] = 0;
	MoveContext ctx = { body, 0, 0 };
	for (int i = 0; i < gs_scene.nodeCount; i++) {
		const GsNode *n = &gs_scene.nodes[i];
		if (n->collider < 0) continue;
		if (node_under(i, body)) {
			body_shapes[ctx.shapeCount++] = i;
		} else if (gs_scene.colliders[n->collider].solid) {
			GsShapeInst inst;
			if (shape_of_node(i, &inst)) solids[ctx.solidCount++] = inst;
		}
	}
	int32_t delta[3] = { dx, dy, dz };
	static const int order[3] = { 1, 0, 2 }; /* Y first, then X, then Z */
	if (ctx.shapeCount > 0 && ctx.solidCount > 0) gs_refresh_subtree(body);
	int stopped = 0;
	for (int o = 0; o < 3; o++) {
		int axis = order[o];
		int32_t remaining = delta[axis];
		while (remaining != 0) {
			int32_t step = remaining > MOVE_STEP ? MOVE_STEP : (remaining < -MOVE_STEP ? -MOVE_STEP : remaining);
			int32_t got = step;
			if (ctx.shapeCount == 0 || ctx.solidCount == 0) gs_node_state[body].position[axis] += step; /* nothing to be stopped by or with */
			else got = move_step(&ctx, axis, step);
			remaining -= step;
			if (got != step) {
				stopped = 1;
				body_flags[body] |= axis == 1 ? (step < 0 ? GS_BODY_FLOOR : GS_BODY_CEILING) : GS_BODY_WALL;
				break;
			}
		}
	}
	if (ctx.shapeCount > 0 && ctx.solidCount > 0) gs_refresh_subtree(body); /* everything under the body, now that it has stopped moving */
	return stopped;
}

int gs_body_state(int body, int mask) {
	if (!body_flags || body < 0 || body >= gs_scene.nodeCount) return 0;
	return (body_flags[body] & mask) != 0;
}
