import { describe, expect, it } from "vitest";

import { getImportedMeshGeometry } from "./imported-mesh";
import { getPrimitiveGeometry, getPrimitiveTriangleCount, SPHERE_RINGS } from "./primitive-geometry";
import { MESH_PRIMITIVES } from "./scene-node";

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

interface Vertex {
  p: V3;
  n: V3;
  uv: [number, number];
}
function vertices(primitive: (typeof MESH_PRIMITIVES)[number]): Vertex[] {
  const g = getPrimitiveGeometry(primitive);
  const out: Vertex[] = [];
  for (let i = 0; i < g.positions.length / 3; i++) {
    out.push({
      p: [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]],
      n: [g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]],
      uv: [g.uvs![i * 2], g.uvs![i * 2 + 1]]
    });
  }
  return out;
}
const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

describe("primitive UV coordinates", () => {
  it("every primitive has two numbers per vertex, and the triangle counts didn't change", () => {
    for (const primitive of MESH_PRIMITIVES) {
      const g = getPrimitiveGeometry(primitive);
      expect(g.uvs).toBeDefined();
      expect(g.uvs!.length).toBe((g.positions.length / 3) * 2);
    }
    expect(MESH_PRIMITIVES.map(getPrimitiveTriangleCount)).toEqual([12, 168, 2, 48]);
  });

  it("cube, plane and sphere stay within 0..1", () => {
    for (const primitive of ["cube", "plane", "sphere"] as const) {
      for (const v of vertices(primitive)) {
        expect(v.uv[0]).toBeGreaterThanOrEqual(0);
        expect(v.uv[0]).toBeLessThanOrEqual(1);
        expect(v.uv[1]).toBeGreaterThanOrEqual(0);
        expect(v.uv[1]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("maps a picture upright and unmirrored on every cube face, seen from outside", () => {
    // For each face, "right" and "down" as a person looking at it from outside would see them. The top's picture-top
    // is toward -Z and the bottom's toward +Z.
    const upOf = (n: V3): V3 => (n[1] === 1 ? [0, 0, -1] : n[1] === -1 ? [0, 0, 1] : [0, 1, 0]);
    let checked = 0;
    for (const v of vertices("cube")) {
      const up = upOf(v.n);
      const right = cross(neg(v.n), up); // forward x up
      const centered = [v.p[0] - v.n[0] * 0.5, v.p[1] - v.n[1] * 0.5, v.p[2] - v.n[2] * 0.5] as V3; // relative to the face's center
      expect(close(v.uv[0], 0.5 + dot(centered, right))).toBe(true);
      expect(close(v.uv[1], 0.5 - dot(centered, up))).toBe(true);
      checked++;
    }
    expect(checked).toBe(36);
  });

  it("maps the plane upright when seen from above with -Z away from the viewer", () => {
    for (const v of vertices("plane")) {
      expect(close(v.uv[0], v.p[0] + 0.5)).toBe(true); // u follows +X
      expect(close(v.uv[1], v.p[2] + 0.5)).toBe(true); // v follows +Z: the far edge (-Z) is the picture's top
    }
    const corners = vertices("plane");
    const far = corners.find((v) => v.p[0] === -0.5 && v.p[2] === -0.5)!;
    const near = corners.find((v) => v.p[0] === 0.5 && v.p[2] === 0.5)!;
    expect(far.uv).toEqual([0, 0]);
    expect(near.uv).toEqual([1, 1]);
  });

  it("wraps the cylinder's side once around, left to right from outside, top edge down", () => {
    const side = vertices("cylinder").filter((v) => Math.abs(v.n[1]) < 1e-9);
    expect(side).toHaveLength(12 * 6);
    for (const v of side) expect(close(v.uv[1], 0.5 - v.p[1])).toBe(true); // v = 0 at the top edge, 1 at the bottom
    // Along a triangle edge, u increases exactly when the point moves to the viewer's right.
    const all = vertices("cylinder");
    for (let t = 0; t < all.length; t += 3) {
      const tri = all.slice(t, t + 3);
      if (tri.some((v) => Math.abs(v.n[1]) > 0.5)) continue; // caps
      for (let i = 0; i < 3; i++) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        const du = b.uv[0] - a.uv[0];
        if (Math.abs(du) < 1e-9) continue;
        const right = cross(neg(a.n), [0, 1, 0]);
        const moved = dot([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]], right);
        expect(Math.sign(du)).toBe(Math.sign(moved));
      }
    }
    // u spans the full 0..1
    expect(Math.min(...side.map((v) => v.uv[0]))).toBe(0);
    expect(Math.max(...side.map((v) => v.uv[0]))).toBe(1);
  });

  it("maps the cylinder's caps as a disc, the top's picture-top toward -Z and the bottom's toward +Z", () => {
    const caps = vertices("cylinder").filter((v) => Math.abs(v.n[1]) > 0.5);
    expect(caps.length).toBe(12 * 6);
    for (const v of caps) {
      expect(close(v.uv[0], v.p[0] + 0.5)).toBe(true);
      expect(close(v.uv[1], v.n[1] > 0 ? v.p[2] + 0.5 : 0.5 - v.p[2])).toBe(true);
    }
  });

  it("maps the sphere equirectangularly: v from the top pole down, u once around, with a seam that doesn't smear", () => {
    const all = vertices("sphere");
    for (const v of all) {
      const phi = Math.acos(Math.max(-1, Math.min(1, v.p[1] / 0.5)));
      expect(close(v.uv[1], Math.round((phi / Math.PI) * SPHERE_RINGS) / SPHERE_RINGS)).toBe(true);
    }
    const us = all.map((v) => v.uv[0]);
    expect(us).toContain(0);
    expect(us).toContain(1); // the seam column gets u = 1, not a second 0
    // No triangle spans more than one segment in u, which is what a smeared seam would do.
    for (let t = 0; t < all.length; t += 3) {
      const tri = all.slice(t, t + 3).map((v) => v.uv[0]);
      expect(Math.max(...tri) - Math.min(...tri)).toBeLessThanOrEqual(1 / 12 + 1e-9);
    }
  });
});

describe("imported models carry UVs into the expanded geometry", () => {
  it("expands UVs in step with positions, and leaves them out when the model has none", () => {
    const withUvs = {
      id: "a",
      name: "quad",
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 1, 1, 1, 1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3]
    };
    const geometry = getImportedMeshGeometry(withUvs);
    expect(geometry.uvs).toEqual([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
    expect(geometry.uvs!.length).toBe((geometry.positions.length / 3) * 2);

    const { uvs: _dropped, ...without } = withUvs;
    expect(getImportedMeshGeometry({ ...without, id: "b" }).uvs).toBeUndefined();
  });
});
