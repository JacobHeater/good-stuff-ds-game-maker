import { describe, expect, it } from "vitest";

import { computeSceneBudget } from "./budget";
import {
  CYLINDER_SEGMENTS,
  getPrimitiveGeometry,
  getPrimitiveTriangleCount,
  SPHERE_RINGS,
  SPHERE_SEGMENTS
} from "./primitive-geometry";
import { createSceneNode, type MeshPrimitive } from "./scene-node";

const PRIMITIVES: MeshPrimitive[] = ["cube", "plane", "cylinder", "sphere"];

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (list: readonly number[], vertex: number): V => [list[vertex * 3], list[vertex * 3 + 1], list[vertex * 3 + 2]];

describe("primitive geometry", () => {
  it("has the documented triangle counts", () => {
    expect(getPrimitiveTriangleCount("cube")).toBe(12);
    expect(getPrimitiveTriangleCount("plane")).toBe(2);
    expect(getPrimitiveTriangleCount("cylinder")).toBe(CYLINDER_SEGMENTS * 4);
    expect(getPrimitiveTriangleCount("sphere")).toBe(SPHERE_SEGMENTS * (2 + 2 * (SPHERE_RINGS - 2)));
  });

  it("is DS-affordable: several spheres fit the per-frame triangle budget", () => {
    // The old, coarser-than-drawn count was 480; the drawn geometry was 720. Neither is acceptable here.
    expect(getPrimitiveTriangleCount("sphere")).toBeLessThanOrEqual(200);
    expect(getPrimitiveTriangleCount("sphere") * 8).toBeLessThan(2048);
  });

  for (const primitive of PRIMITIVES) {
    describe(primitive, () => {
      const g = getPrimitiveGeometry(primitive);

      it("is a whole number of independent triangles with one normal per vertex", () => {
        expect(g.positions.length % 9).toBe(0);
        expect(g.normals.length).toBe(g.positions.length);
        expect(g.triangleCount).toBe(g.positions.length / 9);
      });

      it("fits the DS's 4.12 vertex range with room to spare, and is unit-sized", () => {
        for (const v of g.positions) expect(Math.abs(v)).toBeLessThanOrEqual(0.5 + 1e-9);
      });

      it("has unit-length normals", () => {
        for (let i = 0; i < g.normals.length / 3; i++) {
          const n = at(g.normals, i);
          expect(Math.sqrt(dot(n, n))).toBeCloseTo(1, 6);
        }
      });

      it("has no degenerate triangles", () => {
        for (let t = 0; t < g.triangleCount; t++) {
          const a = at(g.positions, t * 3);
          const b = at(g.positions, t * 3 + 1);
          const c = at(g.positions, t * 3 + 2);
          const n = cross(sub(b, a), sub(c, a));
          expect(dot(n, n)).toBeGreaterThan(1e-12);
        }
      });

      it("winds counter-clockwise seen from the side its normals point to", () => {
        for (let t = 0; t < g.triangleCount; t++) {
          const a = at(g.positions, t * 3);
          const b = at(g.positions, t * 3 + 1);
          const c = at(g.positions, t * 3 + 2);
          const faceNormal = cross(sub(b, a), sub(c, a));
          const avgNormal: V = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const n = at(g.normals, t * 3 + k);
            avgNormal[0] += n[0];
            avgNormal[1] += n[1];
            avgNormal[2] += n[2];
          }
          expect(dot(faceNormal, avgNormal)).toBeGreaterThan(0);
        }
      });
    });
  }

  it("closed shapes face outward: every triangle's normal points away from the center", () => {
    for (const primitive of ["cube", "cylinder", "sphere"] as MeshPrimitive[]) {
      const g = getPrimitiveGeometry(primitive);
      for (let t = 0; t < g.triangleCount; t++) {
        const a = at(g.positions, t * 3);
        const b = at(g.positions, t * 3 + 1);
        const c = at(g.positions, t * 3 + 2);
        const centroid: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        expect(dot(cross(sub(b, a), sub(c, a)), centroid)).toBeGreaterThan(0);
      }
    }
  });

  it("the plane lies flat in XZ and faces up", () => {
    const g = getPrimitiveGeometry("plane");
    for (let i = 0; i < g.positions.length / 3; i++) {
      expect(at(g.positions, i)[1]).toBe(0);
      expect(at(g.normals, i)).toEqual([0, 1, 0]);
    }
  });

  it("the sphere's points are all on its surface", () => {
    const g = getPrimitiveGeometry("sphere");
    for (let i = 0; i < g.positions.length / 3; i++) {
      const p = at(g.positions, i);
      expect(Math.sqrt(dot(p, p))).toBeCloseTo(0.5, 6);
    }
  });

  it("is built once and shared", () => {
    expect(getPrimitiveGeometry("sphere")).toBe(getPrimitiveGeometry("sphere"));
  });
});

describe("the hardware budget counts what is drawn", () => {
  it("charges a mesh the geometry's triangle count, whatever count the node stored", () => {
    const root = createSceneNode({ name: "Main", kind: "Node3D" });
    const sphere = createSceneNode({ name: "S", kind: "MeshInstance3D", mesh: "sphere" });
    sphere.mesh = { primitive: "sphere", triangleCount: 480 }; // as saved by an older version
    root.children.push(sphere);
    expect(computeSceneBudget(root).trianglesUsed).toBe(getPrimitiveTriangleCount("sphere"));
  });

  it("new mesh nodes record the geometry's count", () => {
    for (const primitive of PRIMITIVES) {
      const node = createSceneNode({ name: "M", kind: "MeshInstance3D", mesh: primitive });
      expect(node.mesh?.triangleCount).toBe(getPrimitiveTriangleCount(primitive));
    }
  });
});
