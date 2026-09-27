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
	case GS_SHAPE_CYLINDER: {
		i64 len = (i64)isqrt64((u64)(dl.x * dl.x + dl.z * dl.z));
		V p = mk(0, dl.y >= 0 ? s->p[1] : -(i64)s->p[1], 0);
		if (len != 0) {
			p.x = div64(dl.x * s->p[0], (s32)len);
			p.z = div64(dl.z * s->p[0], (s32)len);
		}
		return p;
	}
	default: { /* GS_SHAPE_HULL: the point of the hull itself farthest along dl -- an O(point count) lookup, not a formula. */
		if (s->hullCount <= 0) return mk(0, 0, 0);
		const int32_t *hp = s->hull;
		V best = mk(hp[0], hp[1], hp[2]);
		i64 bestDot = vdot(dl, best);
		for (int i = 1; i < s->hullCount; i++) {
			V p = mk(hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]);
			i64 d = vdot(dl, p);
			if (d > bestDot) {
				bestDot = d;
				best = p;
			}
		}
		return best;
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
	case GS_SHAPE_HULL: /* p[0] is already its own bounding radius, computed once when the hull was built */
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

static inline int32_t abs32(int32_t v) { return v < 0 ? -v : v; }

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

/*
 * Two boxes, turned any way: the separating axis test (Gottschalk's, as in Ericson's Real-Time Collision Detection). Two convex boxes are apart exactly when some
 * one of 15 axes (the three face directions of each, and the nine cross products of an edge of one with an edge of the other) separates their shadows, and each test is
 * a handful of multiplications: about a twentieth of what the search below costs for the same answer, and a Jenga tower is nothing but boxes turned every way.
 * Shadows that come within SAT_TOL (a thousandth of a unit) count as touching, as in the search. Everything is kept in 32-bit numbers where it can be (the DS has
 * one multiply instruction for those and calls a routine for 64-bit ones) with 24 fractional bits for products.
 */
#define SAT_TOL 4
#define SAT_EPS 8 /* added to the absolute rotation entries so two edges that are nearly parallel don't give a zero axis */
#define M(x, y) ((i64)(x) * (i64)(y))

static int obb_overlap(const GsShapeInst *a, const GsShapeInst *b) {
	int32_t ea[3], eb[3];
	for (int i = 0; i < 3; i++) {
		ea[i] = (int32_t)(((i64)a->p[i] * iabs(a->scale[i])) >> 12);
		eb[i] = (int32_t)(((i64)b->p[i] * iabs(b->scale[i])) >> 12);
	}
	/* The centres apart on each world axis by more than the boxes can reach: cheapest of all, and it keeps the numbers below small. */
	int32_t tw[3];
	const int32_t reach = ea[0] + ea[1] + ea[2] + eb[0] + eb[1] + eb[2] + SAT_TOL;
	for (int i = 0; i < 3; i++) {
		const i64 d = (i64)b->center[i] - a->center[i];
		if (d > reach || d < -reach) return 0;
		tw[i] = (int32_t)d;
	}
	/* R[i][j]: the j-th axis of b in the frame of a; t: b's centre in the frame of a. (a->rotation[row][col] is world row, local column.) */
	int32_t R[3][3], AbsR[3][3], t[3];
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {
			R[i][j] = (int32_t)((M(a->rotation[0][i], b->rotation[0][j]) + M(a->rotation[1][i], b->rotation[1][j]) + M(a->rotation[2][i], b->rotation[2][j])) >> 12);
			AbsR[i][j] = abs32(R[i][j]) + SAT_EPS;
		}
		t[i] = (int32_t)((M(a->rotation[0][i], tw[0]) + M(a->rotation[1][i], tw[1]) + M(a->rotation[2][i], tw[2])) >> 12);
	}
	const i64 tol = (i64)SAT_TOL << 12;
	/* a's face directions */
	for (int i = 0; i < 3; i++) {
		const i64 ra = (i64)ea[i] << 12;
		const i64 rb = M(eb[0], AbsR[i][0]) + M(eb[1], AbsR[i][1]) + M(eb[2], AbsR[i][2]);
		if (M(abs32(t[i]), 4096) > ra + rb + tol) return 0;
	}
	/* b's face directions */
	for (int j = 0; j < 3; j++) {
		const i64 ra = M(ea[0], AbsR[0][j]) + M(ea[1], AbsR[1][j]) + M(ea[2], AbsR[2][j]);
		const i64 rb = (i64)eb[j] << 12;
		const i64 dist = M(t[0], R[0][j]) + M(t[1], R[1][j]) + M(t[2], R[2][j]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	/* the nine cross products */
	/* Written out, so each line is one of Ericson's nine tests. */
	{ /* A0 x B0 */
		const i64 ra = M(ea[1], AbsR[2][0]) + M(ea[2], AbsR[1][0]), rb = M(eb[1], AbsR[0][2]) + M(eb[2], AbsR[0][1]);
		const i64 dist = M(t[2], R[1][0]) - M(t[1], R[2][0]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A0 x B1 */
		const i64 ra = M(ea[1], AbsR[2][1]) + M(ea[2], AbsR[1][1]), rb = M(eb[0], AbsR[0][2]) + M(eb[2], AbsR[0][0]);
		const i64 dist = M(t[2], R[1][1]) - M(t[1], R[2][1]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A0 x B2 */
		const i64 ra = M(ea[1], AbsR[2][2]) + M(ea[2], AbsR[1][2]), rb = M(eb[0], AbsR[0][1]) + M(eb[1], AbsR[0][0]);
		const i64 dist = M(t[2], R[1][2]) - M(t[1], R[2][2]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A1 x B0 */
		const i64 ra = M(ea[0], AbsR[2][0]) + M(ea[2], AbsR[0][0]), rb = M(eb[1], AbsR[1][2]) + M(eb[2], AbsR[1][1]);
		const i64 dist = M(t[0], R[2][0]) - M(t[2], R[0][0]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A1 x B1 */
		const i64 ra = M(ea[0], AbsR[2][1]) + M(ea[2], AbsR[0][1]), rb = M(eb[0], AbsR[1][2]) + M(eb[2], AbsR[1][0]);
		const i64 dist = M(t[0], R[2][1]) - M(t[2], R[0][1]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A1 x B2 */
		const i64 ra = M(ea[0], AbsR[2][2]) + M(ea[2], AbsR[0][2]), rb = M(eb[0], AbsR[1][1]) + M(eb[1], AbsR[1][0]);
		const i64 dist = M(t[0], R[2][2]) - M(t[2], R[0][2]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A2 x B0 */
		const i64 ra = M(ea[0], AbsR[1][0]) + M(ea[1], AbsR[0][0]), rb = M(eb[1], AbsR[2][2]) + M(eb[2], AbsR[2][1]);
		const i64 dist = M(t[1], R[0][0]) - M(t[0], R[1][0]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A2 x B1 */
		const i64 ra = M(ea[0], AbsR[1][1]) + M(ea[1], AbsR[0][1]), rb = M(eb[0], AbsR[2][2]) + M(eb[2], AbsR[2][0]);
		const i64 dist = M(t[1], R[0][1]) - M(t[0], R[1][1]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
	}
	{ /* A2 x B2 */
		const i64 ra = M(ea[0], AbsR[1][2]) + M(ea[1], AbsR[0][2]), rb = M(eb[0], AbsR[2][1]) + M(eb[1], AbsR[2][0]);
		const i64 dist = M(t[1], R[0][2]) - M(t[0], R[1][2]);
		if ((dist < 0 ? -dist : dist) > ra + rb + tol) return 0;
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
	if (a->shape == GS_SHAPE_BOX && b->shape == GS_SHAPE_BOX) return obb_overlap(a, b);
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

/* The shape of a node's collider placed by the transforms as they are (visible or not, and not brought up to date), or 0 when the node has no shape. */
static int shape_raw(int node, GsShapeInst *out) {
	if (node < 0 || node >= gs_scene.nodeCount) return 0;
	const GsNode *n = &gs_scene.nodes[node];
	if (n->collider < 0) return 0;
	const GsCollider *c = &gs_scene.colliders[n->collider];
	out->shape = c->shape;
	for (int i = 0; i < 3; i++) {
		out->p[i] = c->p[i];
		out->scale[i] = gs_world_scale[node][i];
		out->center[i] = gs_world_matrix[node].m[12 + i];
	}
	for (int row = 0; row < 3; row++)
		for (int col = 0; col < 3; col++) out->rotation[row][col] = gs_world_matrix[node].m[col * 4 + row];
	out->hull = c->shape == GS_SHAPE_HULL ? &gs_scene.hullPoints[c->hullStart * 3] : 0;
	out->hullCount = c->hullCount;
	return 1;
}

/* The placed shape of a node's collider from the transforms as they are now, or 0 when the node has no shape or isn't visible. */
static int shape_placed(int node, GsShapeInst *out) {
	if (!shape_raw(node, out)) return 0;
	return gs_world_visible[node];
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
/* A probe point is a sphere this big (0.005 units): a point, for what a probe asks. */
#define PROBE_RADIUS 20
/* Rounds of halving to find where in a step the body meets something: the step's length / 64, under the skin for a step of a quarter of a unit. */
#define BISECTIONS 6

static uint8_t *body_flags;   /* per node: what its last move ran into */
static GsShapeInst *solids;   /* the solid shapes for the move being made */
static int *body_shapes;      /* the node indices of the body's shapes */
static int *solid_nodes;      /* the nodes whose shape is solid: all a move or a probe has to look through (most nodes have no shape, or a shape that isn't solid) */
static int solid_node_count;
static int *shape_frame;      /* per node: 1 + the node of the body's first collision shape (0 = not looked up yet) */

/* Forgets the lists built for the scene being shown (they are built again, for the next scene, the first time a move or a probe needs them). */
void gs_collision_reset(void) {
	free(body_flags);
	free(solids);
	free(body_shapes);
	free(solid_nodes);
	free(shape_frame);
	body_flags = 0;
	solids = 0;
	body_shapes = 0;
	solid_nodes = 0;
	shape_frame = 0;
	solid_node_count = 0;
}

static void ensure_lists(void) {
	if (solid_nodes) return;
	body_flags = calloc(gs_scene.nodeCount, 1);
	solids = malloc(sizeof(GsShapeInst) * (gs_scene.colliderCount + 1));
	body_shapes = malloc(sizeof(int) * (gs_scene.colliderCount + 1));
	solid_nodes = malloc(sizeof(int) * (gs_scene.colliderCount + 1));
	shape_frame = calloc(gs_scene.nodeCount, sizeof(int));
	for (int i = 0; i < gs_scene.nodeCount; i++) {
		const GsNode *n = &gs_scene.nodes[i];
		if (n->collider >= 0 && gs_scene.colliders[n->collider].solid) solid_nodes[solid_node_count++] = i;
	}
}

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

/*
 * The broad phase. Bringing a solid shape up to date costs as much as testing it, so a move or a probe only does that for the solids near it (a Jenga tower has
 * 50 of them and a block touches four). The test has to be cheap too, or it costs what it saves (the DS has no fast 64-bit multiply or square root): the sizes
 * are added up instead of squared (never smaller than the true radius) and the distance is checked one axis at a time.
 */
static inline int32_t mul12(int32_t a, int32_t b) { return (int32_t)(((int64_t)a * b) >> 12); } /* one multiply instruction on the DS */

static int32_t spread_of(int shape, const int32_t p[3], const int32_t scale[3]) {
	const int32_t sx = abs32(scale[0]), sy = abs32(scale[1]), sz = abs32(scale[2]);
	const int32_t smax = sx > sy ? (sx > sz ? sx : sz) : (sy > sz ? sy : sz);
	switch (shape) {
	case GS_SHAPE_BOX:
		return mul12(p[0], sx) + mul12(p[1], sy) + mul12(p[2], sz);
	case GS_SHAPE_SPHERE:
	case GS_SHAPE_HULL:
		return mul12(p[0], smax);
	case GS_SHAPE_CAPSULE:
		return mul12(p[1], sy) + mul12(p[0], smax);
	default:
		return mul12(p[0], sx > sz ? sx : sz) + mul12(p[1], sy);
	}
}

static inline int32_t spread(const GsShapeInst *s) { return spread_of(s->shape, s->p, s->scale); }

/* The same for a node's shape, straight from the collider and the world scale (the node must have a collider). */
static inline int32_t node_spread(int node) {
	const GsCollider *c = &gs_scene.colliders[gs_scene.nodes[node].collider];
	return spread_of(c->shape, c->p, gs_world_scale[node]);
}

/* Whether the node's shape (as last placed, `size` being its spread) could come within `radius` of the point `c`. */
static inline int node_near(int node, int32_t size, const int32_t c[3], int32_t radius) {
	const int32_t reach = radius + size + GS_ONE;
	const int32_t *at = gs_world_matrix[node].m + 12;
	for (int i = 0; i < 3; i++) {
		const int32_t d = at[i] - c[i];
		if (d > reach || d < -reach) return 0;
	}
	return 1;
}

/* Whether the shape `s` (as last placed, `size` being its spread) could come within `radius` of the point `c`. One unit of slack covers a solid that has moved since it was placed. */
static int near_point(const GsShapeInst *s, int32_t size, const int32_t c[3], int32_t radius) {
	const int32_t reach = radius + size + GS_ONE;
	for (int i = 0; i < 3; i++) {
		const int32_t d = s->center[i] - c[i];
		if (d > reach || d < -reach) return 0;
	}
	return 1;
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
	/* A body that is already inside a solid shape (put there by a script, or a tilt that went a little way in) can get out: a move upward is free, and so is any move
	   that ends clear (the test at the top). A move that goes down or sideways and would stay inside is refused, as it would be by any wall: letting it through is how a body
	   sinks through a floor it was pushed a little way into. */
	if (body_hits(ctx)) {
		if (axis != 1 || step < 0) return 0;
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
	ensure_lists();
	body_flags[body] = 0;
	MoveContext ctx = { body, 0, 0 };
	for (int i = 0; i < gs_scene.nodeCount; i++) {
		if (gs_scene.nodes[i].collider >= 0 && node_under(i, body)) body_shapes[ctx.shapeCount++] = i;
	}
	if (ctx.shapeCount > 0) {
		/* Everything the body could touch during this move lies within a sphere around it: the body's shapes and the way it goes. Only the solids in it are used. */
		gs_refresh_subtree(body);
		const int32_t *world = gs_world_matrix[body].m;
		const int32_t around[3] = { world[12], world[13], world[14] };
		int32_t radius = 0;
		for (int i = 0; i < ctx.shapeCount; i++) {
			GsShapeInst inst;
			shape_raw(body_shapes[i], &inst);
			const int32_t r = abs32(inst.center[0] - around[0]) + abs32(inst.center[1] - around[1]) + abs32(inst.center[2] - around[2]) + spread(&inst);
			if (r > radius) radius = r;
		}
		radius += 2 * (abs32(dx) + abs32(dy) + abs32(dz)) + SKIN; /* twice: the move is in the body's own axes, which a parent may stretch */
		for (int k = 0; k < solid_node_count; k++) {
			const int i = solid_nodes[k];
			GsShapeInst inst;
			if (!node_near(i, node_spread(i), around, radius) || node_under(i, body)) continue;
			if (shape_of_node(i, &inst)) solids[ctx.solidCount++] = inst;
		}
	}
	int32_t delta[3] = { dx, dy, dz };
	static const int order[3] = { 1, 0, 2 }; /* Y first, then X, then Z */
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

/* Whether a point (with a hair of a radius) is inside a placed box: the point in the box's own frame against its half extents, no search needed. */
static int point_in_box(const GsShapeInst *box, const int32_t point[3]) {
	const int32_t d[3] = { point[0] - box->center[0], point[1] - box->center[1], point[2] - box->center[2] };
	for (int a = 0; a < 3; a++) {
		const int64_t local = ((int64_t)box->rotation[0][a] * d[0] + (int64_t)box->rotation[1][a] * d[1] + (int64_t)box->rotation[2][a] * d[2]) >> 12;
		const int64_t half = (((int64_t)box->p[a] * iabs(box->scale[a])) >> 12) + PROBE_RADIUS;
		if (local > half || local < -half) return 0;
	}
	return 1;
}

/* The body's first collision shape in tree order (the body itself when it has one): the frame a probe is given in. */
static int frame_of(int body) {
	if (!shape_frame[body]) {
		int found = body;
		for (int i = body; i < gs_scene.nodeCount; i++) {
			if (gs_scene.nodes[i].collider >= 0 && node_under(i, body)) {
				found = i;
				break;
			}
		}
		shape_frame[body] = found + 1;
	}
	return shape_frame[body] - 1;
}

int gs_probe_solid(int body, int32_t y, int32_t x0, int32_t x1, int32_t x2) {
	if (body < 0 || body >= gs_scene.nodeCount) return 0;
	ensure_lists();
	/* The points are given in the frame of the body's first shape (its centre, its turn and its scale: a block whose shape is lifted off its origin or turned a
	   quarter about Y is probed the way it sits), along the shape's longer horizontal side: its Z when the box is longer in Z than in X, its X otherwise. */
	const int frame = frame_of(body);
	gs_refresh_node(frame);
	const int32_t *m = gs_world_matrix[frame].m; /* rotation and translation; the scale is kept apart */
	const int32_t *scale = gs_world_scale[frame];
	int along = 0;
	if (gs_scene.nodes[frame].collider >= 0) {
		const GsCollider *c = &gs_scene.colliders[gs_scene.nodes[frame].collider];
		if (c->shape == GS_SHAPE_BOX && mul12(c->p[2], abs32(scale[2])) > mul12(c->p[0], abs32(scale[0]))) along = 2;
	}
	const int32_t xs[3] = { x0, x1, x2 };
	int32_t points[3][3];
	for (int k = 0; k < 3; k++) {
		const int32_t lift = mul12(y, scale[1]);
		const int32_t slide = mul12(xs[k], scale[along]);
		for (int r = 0; r < 3; r++) points[k][r] = m[12 + r] + mul12(m[4 + r], lift) + mul12(m[along * 4 + r], slide);
	}
	int mask = 0;
	/* The solid shapes that are not under the body (its own shapes don't count). They are taken as they were placed at the start of the frame, not brought up to date:
	   what holds a body up can be a frame old, and bringing each one up to date is most of the cost. Only the ones near a point are tested. */
	for (int j = 0; j < solid_node_count && mask != 7; j++) {
		const int i = solid_nodes[j];
		const int32_t size = node_spread(i);
		int wanted = 0;
		for (int k = 0; k < 3; k++) {
			if (!(mask & (1 << k)) && node_near(i, size, points[k], PROBE_RADIUS)) wanted |= 1 << k;
		}
		GsShapeInst solid;
		if (!wanted || node_under(i, body) || !shape_placed(i, &solid)) continue;
		for (int k = 0; k < 3; k++) {
			if (!(wanted & (1 << k))) continue;
			int held;
			if (solid.shape == GS_SHAPE_BOX) {
				held = point_in_box(&solid, points[k]);
			} else {
				GsShapeInst point;
				point.shape = GS_SHAPE_SPHERE;
				point.p[0] = PROBE_RADIUS;
				point.p[1] = 0;
				point.p[2] = 0;
				for (int r = 0; r < 3; r++) {
					point.scale[r] = GS_ONE;
					point.center[r] = points[k][r];
					for (int c = 0; c < 3; c++) point.rotation[r][c] = r == c ? GS_ONE : 0;
				}
				held = gs_shapes_overlap(&point, &solid);
			}
			if (held) mask |= 1 << k;
		}
	}
	return mask;
}

/* ---- Rays ------------------------------------------------------------------------------------------------------------------------ */

/* A ray meets a non-box shape where a sphere this big (0.03 units), moved along the ray in steps of its width, first overlaps it. */
#define RAY_PROBE 120
#define RAY_MISS (-GS_ONE)

/* The distance along the ray (origin `o`, unit direction `u`, both f32) at which it enters a placed box, or -1 when it doesn't within `max`: the slab test in the box's own frame. */
static int32_t ray_vs_box(const GsShapeInst *box, const int32_t o[3], const int32_t u[3], int32_t max) {
	i64 tmin = -((i64)1 << 40), tmax = (i64)1 << 40;
	for (int a = 0; a < 3; a++) {
		const i64 d0 = (i64)o[0] - box->center[0], d1 = (i64)o[1] - box->center[1], d2 = (i64)o[2] - box->center[2];
		i64 lo = ((i64)box->rotation[0][a] * d0 + (i64)box->rotation[1][a] * d1 + (i64)box->rotation[2][a] * d2) >> 12;
		i64 lu = ((i64)box->rotation[0][a] * u[0] + (i64)box->rotation[1][a] * u[1] + (i64)box->rotation[2][a] * u[2]) >> 12;
		if (box->scale[a] == 0) return RAY_MISS;
		lo = div64(lo << 12, (s32)box->scale[a]);
		lu = div64(lu << 12, (s32)box->scale[a]);
		const i64 half = box->p[a];
		if (iabs(lu) < 4) {
			if (iabs(lo) > half) return RAY_MISS; /* parallel to this pair of faces and outside them */
			continue;
		}
		i64 t1 = div64((-half - lo) << 12, (s32)lu);
		i64 t2 = div64((half - lo) << 12, (s32)lu);
		if (t1 > t2) {
			const i64 swap = t1;
			t1 = t2;
			t2 = swap;
		}
		if (t1 > tmin) tmin = t1;
		if (t2 < tmax) tmax = t2;
		if (tmin > tmax) return RAY_MISS;
	}
	if (tmax < 0) return RAY_MISS; /* the box is behind the ray */
	if (tmin < 0) tmin = 0;        /* the ray starts inside it */
	return tmin > max ? RAY_MISS : (int32_t)tmin;
}

/* The same for any other shape: marched along in small steps inside the shape's bounding sphere, then narrowed down by halving. */
static int32_t ray_vs_shape(const GsShapeInst *s, const int32_t o[3], const int32_t u[3], int32_t max) {
	const i64 radius = (i64)bound_radius(s) + RAY_PROBE;
	i64 c[3];
	for (int a = 0; a < 3; a++) c[a] = (i64)s->center[a] - o[a];
	const i64 along = (c[0] * u[0] + c[1] * u[1] + c[2] * u[2]) >> 12;
	const i64 gap2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - along * along;
	if (gap2 > radius * radius) return RAY_MISS;
	const i64 half = (i64)isqrt64((u64)(radius * radius - (gap2 < 0 ? 0 : gap2)));
	i64 t0 = along - half, t1 = along + half;
	if (t1 < 0 || t0 > max) return RAY_MISS;
	if (t0 < 0) t0 = 0;
	if (t1 > max) t1 = max;
	GsShapeInst point;
	point.shape = GS_SHAPE_SPHERE;
	point.p[0] = RAY_PROBE;
	point.p[1] = 0;
	point.p[2] = 0;
	for (int r = 0; r < 3; r++)
		for (int k = 0; k < 3; k++) point.rotation[r][k] = r == k ? GS_ONE : 0;
	for (int r = 0; r < 3; r++) point.scale[r] = GS_ONE;
	i64 before = t0 - 1;
	for (i64 t = t0;; t += 2 * RAY_PROBE) {
		if (t > t1) t = t1;
		for (int a = 0; a < 3; a++) point.center[a] = o[a] + (int32_t)(((i64)u[a] * t) >> 12);
		if (gs_shapes_overlap(&point, s)) {
			i64 lo = before < t0 ? t0 : before, hi = t;
			if (t == t0) return (int32_t)t0;
			for (int i = 0; i < 4; i++) {
				const i64 mid = (lo + hi) >> 1;
				for (int a = 0; a < 3; a++) point.center[a] = o[a] + (int32_t)(((i64)u[a] * mid) >> 12);
				if (gs_shapes_overlap(&point, s)) hi = mid;
				else lo = mid;
			}
			return (int32_t)hi;
		}
		if (t >= t1) return RAY_MISS;
		before = t;
	}
}

int32_t gs_ray_cast(int body, int32_t ox, int32_t oy, int32_t oz, int32_t dx, int32_t dy, int32_t dz, int32_t max) {
	if (body < 0 || body >= gs_scene.nodeCount || max <= 0) return RAY_MISS;
	ensure_lists();
	const i64 length = (i64)isqrt64((u64)((i64)dx * dx + (i64)dy * dy + (i64)dz * dz));
	if (length == 0) return RAY_MISS;
	const int32_t origin[3] = { ox, oy, oz };
	const int32_t u[3] = { (int32_t)div64((i64)dx << 12, (s32)length), (int32_t)div64((i64)dy << 12, (s32)length), (int32_t)div64((i64)dz << 12, (s32)length) };
	int32_t nearest = max;
	int found = 0;
	for (int j = 0; j < solid_node_count; j++) {
		const int i = solid_nodes[j];
		/* Nearly all shapes are nowhere near the ray: their centres against the ray, with one unit of slack for a solid that has moved since it was placed (no divisions). */
		const i64 reach = (i64)node_spread(i) + RAY_PROBE + GS_ONE;
		const int32_t *at = gs_world_matrix[i].m + 12;
		const i64 cx = (i64)at[0] - origin[0], cy = (i64)at[1] - origin[1], cz = (i64)at[2] - origin[2];
		const i64 along = (cx * u[0] + cy * u[1] + cz * u[2]) >> 12;
		if (along < -reach || along > (i64)nearest + reach || cx * cx + cy * cy + cz * cz - along * along > reach * reach) continue;
		GsShapeInst solid;
		if (node_under(i, body) || !shape_placed(i, &solid)) continue;
		const int32_t t = solid.shape == GS_SHAPE_BOX ? ray_vs_box(&solid, origin, u, nearest) : ray_vs_shape(&solid, origin, u, nearest);
		if (t >= 0 && t <= nearest) {
			nearest = t;
			found = 1;
		}
	}
	return found ? nearest : RAY_MISS;
}

int gs_body_state(int body, int mask) {
	if (!body_flags || body < 0 || body >= gs_scene.nodeCount) return 0;
	return (body_flags[body] & mask) != 0;
}
