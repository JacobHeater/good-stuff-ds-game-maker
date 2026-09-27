import type { Vector3 } from "./scene-node";

/**
 * An approximate convex hull, for a collision shape that wraps a mesh or sprite (requirements/collision/STORY.collision-polygon-wraps-mesh.md).
 *
 * The DS's collision math (gs_collision.c) tests any convex shape by its "support function" — the shape's own point farthest along a direction —
 * so a hull only needs to be *a set of real points of the input*, not a full polytope of faces and edges: every point returned here is one of the
 * input points (never invented), so the result is always genuinely convex and always inside (or on) the true hull.
 *
 * The 26 directions are a "26-DOP": the 6 axes, the 8 cube-corner diagonals and the 12 edge diagonals of a cube — a standard, cheap way to bound a
 * shape from many sides at once. Sampling more directions would hug a spiky or rounded mesh tighter, at the cost of more collision points to check
 * on the DS every frame (`gs_shapes_overlap`'s support function is O(point count) for a hull, unlike a box or sphere's O(1)); 26 is a reasonable,
 * well-known balance, tight enough for most game meshes without being slow to check. A very thin spike that happens to point between two of the 26
 * directions can be clipped a little short — see the story doc.
 */
const D26: readonly Vector3[] = (() => {
  const dirs: Vector3[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        dirs.push({ x, y, z });
      }
    }
  }
  return dirs;
})();

/** Points within this fraction of the shape's own size count as the same point (so many directions landing on one real vertex, as a box's corner does, contribute it once). */
const MERGE_FRACTION = 1e-4;

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The points of `points` that are extreme (farthest out) along at least one of `directions` (default: the 26-DOP directions above), each returned
 * once. Near-duplicates (within a small fraction of the point cloud's own size) are merged, so a flat-faced mesh doesn't contribute a cluster of
 * almost-identical points for one true vertex. Never returns more points than `directions` has. Degenerate input (0 or 1 distinct points) is
 * returned as-is; the caller decides how a shape with fewer than 4 points (a point, a segment, a flat polygon) is handled.
 */
export function approximateConvexHull(points: readonly Vector3[], directions: readonly Vector3[] = D26): Vector3[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);
  const mergeDist2 = (span * MERGE_FRACTION) ** 2;

  const hull: Vector3[] = [];
  for (const dir of directions) {
    let best = points[0];
    let bestDot = dot(points[0], dir);
    for (let i = 1; i < points.length; i++) {
      const d = dot(points[i], dir);
      if (d > bestDot) {
        bestDot = d;
        best = points[i];
      }
    }
    if (!hull.some((p) => (p.x - best.x) ** 2 + (p.y - best.y) ** 2 + (p.z - best.z) ** 2 <= mergeDist2)) hull.push(best);
  }
  return hull;
}
