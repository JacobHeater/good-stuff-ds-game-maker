import type { CollisionShapeData } from "@goodstuff/core";

/**
 * The outline of a collision shape, as pairs of points (x, y, z, x, y, z) for a set of line segments, in the node's own space: capsules and
 * cylinders stand along Y and the shape is centered on the origin. Pure, so what the viewport draws can be checked without a canvas.
 * (requirements/collision/TASK.collision-shape-inspector-and-viewport.md)
 */
const CIRCLE_SEGMENTS = 32;

type Point = [number, number, number];

/** A closed circle of `radius` in the plane through `axisA` and `axisB` (0 = x, 1 = y, 2 = z), at `offset` along the third axis. */
function circle(radius: number, axisA: number, axisB: number, offset: number, lines: number[]): void {
  const third = 3 - axisA - axisB;
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const from = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const to = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a: Point = [0, 0, 0];
    const b: Point = [0, 0, 0];
    a[axisA] = Math.cos(from) * radius;
    a[axisB] = Math.sin(from) * radius;
    a[third] = offset;
    b[axisA] = Math.cos(to) * radius;
    b[axisB] = Math.sin(to) * radius;
    b[third] = offset;
    lines.push(...a, ...b);
  }
}

/** A half circle (the round end of a capsule) in the plane of `axisA` (x or z) and y, bulging up (`sign` 1) or down (-1) from `offset` on y. */
function arc(radius: number, axisA: 0 | 2, sign: 1 | -1, offset: number, lines: number[]): void {
  const half = CIRCLE_SEGMENTS / 2;
  for (let i = 0; i < half; i++) {
    const from = (i / half) * Math.PI;
    const to = ((i + 1) / half) * Math.PI;
    const a: Point = [0, offset + sign * Math.sin(from) * radius, 0];
    const b: Point = [0, offset + sign * Math.sin(to) * radius, 0];
    a[axisA] = Math.cos(from) * radius;
    b[axisA] = Math.cos(to) * radius;
    lines.push(...a, ...b);
  }
}

function line(a: Point, b: Point, lines: number[]): void {
  lines.push(...a, ...b);
}

/** The straight lines joining the two end rings at the four sides. */
function sides(radius: number, halfHeight: number, lines: number[]): void {
  for (const [x, z] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
    line([x, -halfHeight, z], [x, halfHeight, z], lines);
  }
}

export function collisionWireframe(shape: Pick<CollisionShapeData, "shape" | "size" | "radius" | "height">): Float32Array {
  const lines: number[] = [];
  switch (shape.shape) {
    case "box": {
      const [hx, hy, hz] = [shape.size.x / 2, shape.size.y / 2, shape.size.z / 2];
      const corners: Point[] = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) corners.push([x, y, z]);
      // Corners differ in one coordinate exactly when their indices differ in one bit.
      for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (i < (i ^ bit)) line(corners[i], corners[i ^ bit], lines);
      break;
    }
    case "sphere":
      circle(shape.radius, 0, 1, 0, lines);
      circle(shape.radius, 1, 2, 0, lines);
      circle(shape.radius, 0, 2, 0, lines);
      break;
    case "cylinder": {
      const half = shape.height / 2;
      circle(shape.radius, 0, 2, half, lines);
      circle(shape.radius, 0, 2, -half, lines);
      sides(shape.radius, half, lines);
      break;
    }
    case "capsule": {
      // The straight part is the height less the two round ends.
      const half = Math.max(0, shape.height / 2 - shape.radius);
      circle(shape.radius, 0, 2, half, lines);
      circle(shape.radius, 0, 2, -half, lines);
      sides(shape.radius, half, lines);
      for (const axis of [0, 2] as const) {
        arc(shape.radius, axis, 1, half, lines);
        arc(shape.radius, axis, -1, -half, lines);
      }
      break;
    }
  }
  return new Float32Array(lines);
}
