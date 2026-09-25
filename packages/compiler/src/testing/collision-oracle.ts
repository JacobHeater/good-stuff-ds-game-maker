/**
 * An independent answer to "do these two collision shapes overlap?", for checking the DS's GJK (runtime/source/gs_collision.c) against.
 *
 * It uses a different method on purpose. Two convex shapes A and B (shapes centered on their nodes, so mirror-symmetric) overlap exactly when
 * the origin is inside "A minus B", and that holds exactly when, for EVERY direction d, the support function of A - B is not negative:
 *
 *     f(d) = width_A(d) + width_B(d) - d . (centerB - centerA)  >=  0        (width is how far the shape reaches along d from its center)
 *
 * The smallest f over the unit directions is therefore a signed clearance: positive when the shapes overlap (by about that much, along the
 * best direction to push them apart), negative when they are apart (by that much). It is found by trying tens of thousands of directions spread
 * evenly over the sphere and then improving the best ones. No closest points, no simplex: just support functions, in double precision.
 */

export type ShapeKind = "box" | "sphere" | "capsule" | "cylinder";

/** A shape as the runtime is given it: sizes, rotation, scale and position in 20.12 fixed point (integers). See `GsShapeInst` in gs_collision.h. */
export interface PlacedShape {
  shape: ShapeKind;
  /** Box: half extents. Sphere: radius. Capsule: radius, half the straight part. Cylinder: radius, half the height. */
  p: [number, number, number];
  /** Row-major rotation[row][col]. */
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  scale: [number, number, number];
  center: [number, number, number];
}

export const SHAPE_CODE: Record<ShapeKind, number> = { box: 0, sphere: 1, capsule: 2, cylinder: 3 };
const ONE = 4096;

type Vec = [number, number, number];

/** How far the shape reaches along the unit direction `d` from its center. */
function width(s: PlacedShape, d: Vec): number {
  const R = s.rotation;
  // The shape is R * (S * p) for a point p of the basic shape, so its reach along d is the basic shape's reach along S * R^T d.
  const t: Vec = [
    (R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2]) / ONE,
    (R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2]) / ONE,
    (R[0][2] * d[0] + R[1][2] * d[1] + R[2][2] * d[2]) / ONE
  ];
  const dl: Vec = [(s.scale[0] / ONE) * t[0], (s.scale[1] / ONE) * t[1], (s.scale[2] / ONE) * t[2]];
  const [p0, p1, p2] = [s.p[0] / ONE, s.p[1] / ONE, s.p[2] / ONE];
  switch (s.shape) {
    case "box":
      return p0 * Math.abs(dl[0]) + p1 * Math.abs(dl[1]) + p2 * Math.abs(dl[2]);
    case "sphere":
      return p0 * Math.hypot(dl[0], dl[1], dl[2]);
    case "capsule":
      return p0 * Math.hypot(dl[0], dl[1], dl[2]) + p1 * Math.abs(dl[1]);
    case "cylinder":
      return p0 * Math.hypot(dl[0], dl[2]) + p1 * Math.abs(dl[1]);
  }
}

/** The signed clearance of two placed shapes, in world units: positive when they overlap, negative when apart. */
export function clearance(a: PlacedShape, b: PlacedShape): number {
  const delta: Vec = [(b.center[0] - a.center[0]) / ONE, (b.center[1] - a.center[1]) / ONE, (b.center[2] - a.center[2]) / ONE];
  const f = (d: Vec): number => width(a, d) + width(b, d) - (d[0] * delta[0] + d[1] * delta[1] + d[2] * delta[2]);

  // Directions spread evenly over the sphere (a Fibonacci spiral), then the axes and the direction between the centers.
  const samples: Array<{ d: Vec; value: number }> = [];
  const N = 40000;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - y * y);
    const d: Vec = [Math.cos(golden * i) * r, y, Math.sin(golden * i) * r];
    samples.push({ d, value: f(d) });
  }
  const length = Math.hypot(...delta);
  const extras: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  if (length > 0) extras.push(delta.map((v) => v / length) as Vec, delta.map((v) => -v / length) as Vec);
  for (const d of extras) samples.push({ d, value: f(d) });
  samples.sort((x, y) => x.value - y.value);

  // Improve the best few by a pattern search on the sphere.
  let best = Infinity;
  for (const start of samples.slice(0, 12)) {
    let d = start.d;
    let value = start.value;
    let step = 0.03;
    while (step > 1e-6) {
      const helper: Vec = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = cross(d, helper);
      const uLength = Math.hypot(...u);
      const u1: Vec = [u[0] / uLength, u[1] / uLength, u[2] / uLength];
      const u2 = cross(d, u1);
      let moved = false;
      for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        const c: Vec = [d[0] + step * (x * u1[0] + y * u2[0]), d[1] + step * (x * u1[1] + y * u2[1]), d[2] + step * (x * u1[2] + y * u2[2])];
        const cl = Math.hypot(...c);
        const candidate: Vec = [c[0] / cl, c[1] / cl, c[2] / cl];
        const v = f(candidate);
        if (v < value) {
          d = candidate;
          value = v;
          moved = true;
        }
      }
      if (!moved) step /= 2;
    }
    if (value < best) best = value;
  }
  return best;
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A rough size of the shape (its bounding sphere's radius, in world units), for choosing how far apart to put shapes and how close a call is too close. */
export function boundRadius(s: PlacedShape): number {
  const scale = s.scale.map((v) => Math.abs(v) / ONE);
  const [p0, p1, p2] = [s.p[0] / ONE, s.p[1] / ONE, s.p[2] / ONE];
  const smax = Math.max(...scale);
  switch (s.shape) {
    case "box":
      return Math.hypot(p0 * scale[0], p1 * scale[1], p2 * scale[2]);
    case "sphere":
      return p0 * smax;
    case "capsule":
      return p1 * scale[1] + p0 * smax;
    case "cylinder":
      return Math.hypot(p0 * Math.max(scale[0], scale[2]), p1 * scale[1]);
  }
}
