import { describe, expect, it } from "vitest";

import { collisionWireframe } from "./collision-wireframe";

const SIZE = { x: 1, y: 1, z: 1 };
function extents(points: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], points[i + a]);
      max[a] = Math.max(max[a], points[i + a]);
    }
  }
  return { min, max };
}
const close = (values: number[], expected: number[]): void => values.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));

describe("the wireframe of a collision shape", () => {
  it("is a box's twelve edges, spanning its full size around the center", () => {
    const wire = collisionWireframe({ shape: "box", size: { x: 2, y: 4, z: 6 }, radius: 0.5, height: 2 });
    expect(wire.length / 6).toBe(12);
    const { min, max } = extents(wire);
    close(min, [-1, -2, -3]);
    close(max, [1, 2, 3]);
  });

  it("is a sphere's three great circles of the radius", () => {
    const wire = collisionWireframe({ shape: "sphere", size: SIZE, radius: 1.5, height: 2 });
    const { min, max } = extents(wire);
    close(min, [-1.5, -1.5, -1.5]);
    close(max, [1.5, 1.5, 1.5]);
    for (let i = 0; i < wire.length; i += 3) expect(Math.hypot(wire[i], wire[i + 1], wire[i + 2])).toBeCloseTo(1.5, 4);
  });

  it("is a cylinder standing on Y: the height along Y, the radius across", () => {
    const { min, max } = extents(collisionWireframe({ shape: "cylinder", size: SIZE, radius: 0.75, height: 3 }));
    close(min, [-0.75, -1.5, -0.75]);
    close(max, [0.75, 1.5, 0.75]);
  });

  it("is a capsule whose total height includes its round ends", () => {
    const wire = collisionWireframe({ shape: "capsule", size: SIZE, radius: 0.5, height: 2 });
    const { min, max } = extents(wire);
    close(min, [-0.5, -1, -0.5]);
    close(max, [0.5, 1, 0.5]);
    // Every point is within the radius of the straight segment from (0, -0.5, 0) to (0, 0.5, 0).
    for (let i = 0; i < wire.length; i += 3) {
      const nearestY = Math.min(0.5, Math.max(-0.5, wire[i + 1]));
      expect(Math.hypot(wire[i], wire[i + 1] - nearestY, wire[i + 2])).toBeCloseTo(0.5, 4);
    }
  });

  it("draws a capsule as a sphere when its height is twice its radius", () => {
    const wire = collisionWireframe({ shape: "capsule", size: SIZE, radius: 1, height: 2 });
    for (let i = 0; i < wire.length; i += 3) expect(Math.hypot(wire[i], wire[i + 1], wire[i + 2])).toBeCloseTo(1, 4);
  });
});
