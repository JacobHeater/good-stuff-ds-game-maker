import { describe, expect, it } from "vitest";

import { approximateConvexHull } from "./convex-hull";
import type { Vector3 } from "./scene-node";

const V = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const has = (hull: Vector3[], p: Vector3): boolean => hull.some((h) => Math.abs(h.x - p.x) < 1e-6 && Math.abs(h.y - p.y) < 1e-6 && Math.abs(h.z - p.z) < 1e-6);

describe("approximateConvexHull", () => {
  it("returns nothing for no points", () => {
    expect(approximateConvexHull([])).toEqual([]);
  });

  it("returns the single point for one point (or a cluster of the same point)", () => {
    expect(approximateConvexHull([V(1, 2, 3)])).toEqual([V(1, 2, 3)]);
    expect(approximateConvexHull([V(1, 2, 3), V(1, 2, 3), V(1, 2, 3)])).toEqual([V(1, 2, 3)]);
  });

  it("finds every corner of a box, and only the corners (interior/face-center points are dropped)", () => {
    const corners: Vector3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(V(x, y, z));
    const extras = [V(0, 0, 0), V(0.5, 0, 0), V(0, 0.9, 0.9)]; // center, and points on faces/edges, not sticking out past any corner
    const hull = approximateConvexHull([...corners, ...extras]);
    expect(hull).toHaveLength(8);
    for (const c of corners) expect(has(hull, c)).toBe(true);
    for (const e of extras) expect(has(hull, e)).toBe(false);
  });

  it("works for a flat (2D) shape: a square lying in the XY plane", () => {
    const square = [V(-1, -1, 0), V(1, -1, 0), V(1, 1, 0), V(-1, 1, 0)];
    const hull = approximateConvexHull([...square, V(0, 0, 0)]);
    expect(hull).toHaveLength(4);
    for (const c of square) expect(has(hull, c)).toBe(true);
  });

  it("works for a flat shape along a single axis (a segment)", () => {
    const hull = approximateConvexHull([V(-2, 0, 0), V(2, 0, 0), V(0, 0, 0)]);
    expect(hull).toHaveLength(2);
    expect(has(hull, V(-2, 0, 0))).toBe(true);
    expect(has(hull, V(2, 0, 0))).toBe(true);
  });

  it("every point it returns is one of the real input points (never invented)", () => {
    const points: Vector3[] = [];
    for (let i = 0; i < 200; i++) {
      const theta = (i / 200) * Math.PI * 2;
      const phi = ((i * 7) % 200) / 200 * Math.PI;
      points.push(V(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)));
    }
    const hull = approximateConvexHull(points);
    expect(hull.length).toBeGreaterThan(0);
    expect(hull.length).toBeLessThanOrEqual(26);
    for (const h of hull) expect(points.some((p) => p.x === h.x && p.y === h.y && p.z === h.z)).toBe(true);
  });

  it("never returns more points than there are directions", () => {
    const points = Array.from({ length: 500 }, () => V(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5));
    const few = [V(1, 0, 0), V(-1, 0, 0)];
    expect(approximateConvexHull(points, few).length).toBeLessThanOrEqual(2);
  });

  it("a point strictly inside the hull of the others is never included", () => {
    const corners: Vector3[] = [];
    for (const x of [-5, 5]) for (const y of [-5, 5]) for (const z of [-5, 5]) corners.push(V(x, y, z));
    const inside = V(1, -2, 0.5);
    const hull = approximateConvexHull([...corners, inside]);
    expect(has(hull, inside)).toBe(false);
  });
});
