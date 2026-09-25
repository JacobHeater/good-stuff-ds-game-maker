import { describe, expect, it } from "vitest";

import { COLLISION_SIZE_MAX, COLLISION_SIZE_MIN, getCollisionShape, normalizeCollisionShape } from "./collision-shape";

describe("getCollisionShape", () => {
  it("gives a node with no collision data a 1 x 1 x 1 box, radius 0.5 and height 2", () => {
    expect(getCollisionShape({})).toEqual({ shape: "box", size: { x: 1, y: 1, z: 1 }, radius: 0.5, height: 2, solid: false });
  });

  it("fills in whatever a saved node leaves out, and keeps what it has", () => {
    expect(getCollisionShape({ collision: { shape: "sphere", radius: 2 } })).toEqual({ shape: "sphere", size: { x: 1, y: 1, z: 1 }, radius: 2, height: 2, solid: false });
    expect(getCollisionShape({ collision: { size: { y: 3 } } }).size).toEqual({ x: 1, y: 3, z: 1 });
  });

  it("raises a capsule that is shorter than it is wide to twice its radius", () => {
    expect(getCollisionShape({ collision: { shape: "capsule", radius: 1.5, height: 2 } }).height).toBe(3);
    expect(getCollisionShape({ collision: { shape: "capsule", radius: 0.3, height: 1.4 } }).height).toBe(1.4);
  });

  it("leaves a cylinder's height alone, whatever its radius", () => {
    expect(getCollisionShape({ collision: { shape: "cylinder", radius: 3, height: 1 } }).height).toBe(1);
  });

  it("keeps every size inside the range", () => {
    const shape = normalizeCollisionShape({ shape: "box", size: { x: 0, y: -5, z: 5000 }, radius: 0, height: 99999, solid: false });
    expect(shape.size).toEqual({ x: COLLISION_SIZE_MIN, y: COLLISION_SIZE_MIN, z: COLLISION_SIZE_MAX });
    expect(shape.radius).toBe(COLLISION_SIZE_MIN);
    expect(shape.height).toBe(COLLISION_SIZE_MAX);
  });

  it("is not solid unless it says so, and keeps solid through normalizing", () => {
    expect(getCollisionShape({ collision: { shape: "box" } }).solid).toBe(false);
    expect(getCollisionShape({ collision: { solid: true } }).solid).toBe(true);
    expect(normalizeCollisionShape({ shape: "capsule", size: { x: 1, y: 1, z: 1 }, radius: 1, height: 1, solid: true }).solid).toBe(true);
  });
});
