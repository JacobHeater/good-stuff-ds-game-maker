import type { MeshPrimitive } from "./scene-node";

/**
 * The one definition of each built-in primitive's geometry. The editor's 3D
 * viewport draws exactly this, the hardware budget counts exactly this, and the
 * compiler emits exactly this — nothing else carries a per-primitive triangle
 * count (see requirements/debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md).
 *
 * Geometry is a plain non-indexed triangle list with one normal per vertex
 * (three floats each for `positions` and `normals`), because that is what the
 * DS's geometry engine takes: independent triangles, no index buffers. Winding is
 * counter-clockwise when viewed from outside, so the front face is the outward
 * one in both three.js and the DS.
 *
 * Every primitive is unit-sized and centered on the origin. Size and placement
 * come from a node's transform, which keeps vertex coordinates small — the DS's
 * vertex format is 4.12 fixed point, so roughly ±8.
 *
 * The sphere and cylinder are deliberately coarse. A DS frame holds about 2048
 * triangles, so a smooth 720-triangle sphere would leave room for almost
 * nothing else; 168 lets a scene hold several.
 */
export interface PrimitiveGeometry {
  /** x, y, z per vertex; three vertices per triangle. */
  readonly positions: readonly number[];
  /** x, y, z per vertex, unit length. Same length as `positions`. */
  readonly normals: readonly number[];
  readonly triangleCount: number;
}

/** Sphere: this many segments around, this many rings from pole to pole. */
export const SPHERE_SEGMENTS = 12;
export const SPHERE_RINGS = 8;
/** Cylinder: this many segments around. */
export const CYLINDER_SEGMENTS = 12;

type Vec3 = readonly [number, number, number];

class TriangleList {
  readonly positions: number[] = [];
  readonly normals: number[] = [];

  /** Adds one triangle. Vertices must be counter-clockwise seen from outside; normals are per vertex. */
  add(a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3 = na, nc: Vec3 = na): void {
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...na, ...nb, ...nc);
  }

  /** A quad a-b-c-d (counter-clockwise from outside) as two triangles sharing one flat normal. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3): void {
    this.add(a, b, c, n);
    this.add(a, c, d, n);
  }

  build(): PrimitiveGeometry {
    return { positions: this.positions, normals: this.normals, triangleCount: this.positions.length / 9 };
  }
}

function cube(): PrimitiveGeometry {
  const t = new TriangleList();
  const h = 0.5;
  t.quad([h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h], [1, 0, 0]); // +X
  t.quad([-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h], [-1, 0, 0]); // -X
  t.quad([-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h], [0, 1, 0]); // +Y
  t.quad([-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [0, -1, 0]); // -Y
  t.quad([-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], [0, 0, 1]); // +Z
  t.quad([h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h], [0, 0, -1]); // -Z
  return t.build();
}

function plane(): PrimitiveGeometry {
  // Lies in the XZ plane, facing +Y.
  const t = new TriangleList();
  const h = 0.5;
  t.quad([-h, 0, h], [h, 0, h], [h, 0, -h], [-h, 0, -h], [0, 1, 0]);
  return t.build();
}

function cylinder(): PrimitiveGeometry {
  // Axis along Y, radius 0.5, height 1, flat caps, smooth-shaded side.
  const t = new TriangleList();
  const r = 0.5;
  const h = 0.5;
  const point = (i: number): [number, number] => {
    const angle = (i / CYLINDER_SEGMENTS) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };
  for (let i = 0; i < CYLINDER_SEGMENTS; i++) {
    const [c0, s0] = point(i);
    const [c1, s1] = point(i + 1);
    const n0: Vec3 = [c0, 0, -s0];
    const n1: Vec3 = [c1, 0, -s1];
    const p0: Vec3 = [r * c0, -h, -r * s0];
    const p1: Vec3 = [r * c1, -h, -r * s1];
    const q0: Vec3 = [r * c0, h, -r * s0];
    const q1: Vec3 = [r * c1, h, -r * s1];
    t.add(p0, p1, q1, n0, n1, n1); // side
    t.add(p0, q1, q0, n0, n1, n0);
    t.add([0, h, 0], q0, q1, [0, 1, 0]); // top cap
    t.add([0, -h, 0], p1, p0, [0, -1, 0]); // bottom cap
  }
  return t.build();
}

function sphere(): PrimitiveGeometry {
  // Radius 0.5, poles on ±Y, smooth-shaded: a vertex's normal is its direction from the center.
  const t = new TriangleList();
  const r = 0.5;
  const vertex = (ring: number, segment: number): [Vec3, Vec3] => {
    const phi = (ring / SPHERE_RINGS) * Math.PI; // 0 at the top pole, PI at the bottom
    const theta = (segment / SPHERE_SEGMENTS) * Math.PI * 2;
    const n: Vec3 = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), -Math.sin(phi) * Math.sin(theta)];
    return [[r * n[0], r * n[1], r * n[2]], n];
  };
  for (let ring = 0; ring < SPHERE_RINGS; ring++) {
    for (let seg = 0; seg < SPHERE_SEGMENTS; seg++) {
      const [tl, ntl] = vertex(ring, seg);
      const [tr, ntr] = vertex(ring, seg + 1);
      const [bl, nbl] = vertex(ring + 1, seg);
      const [br, nbr] = vertex(ring + 1, seg + 1);
      if (ring === 0) {
        t.add(tl, bl, br, ntl, nbl, nbr); // the top row is a fan around the pole: one triangle per segment
      } else if (ring === SPHERE_RINGS - 1) {
        t.add(tl, bl, tr, ntl, nbl, ntr); // and so is the bottom row
      } else {
        t.add(tl, bl, br, ntl, nbl, nbr);
        t.add(tl, br, tr, ntl, nbr, ntr);
      }
    }
  }
  return t.build();
}

const BUILDERS: Record<MeshPrimitive, () => PrimitiveGeometry> = { cube, plane, cylinder, sphere };
const cache = new Map<MeshPrimitive, PrimitiveGeometry>();

/** The geometry of a built-in primitive. Built once and shared; do not mutate it. */
export function getPrimitiveGeometry(primitive: MeshPrimitive): PrimitiveGeometry {
  let geometry = cache.get(primitive);
  if (!geometry) {
    geometry = BUILDERS[primitive]();
    cache.set(primitive, geometry);
  }
  return geometry;
}

/** How many triangles one instance of `primitive` costs. Always derived from the geometry itself. */
export function getPrimitiveTriangleCount(primitive: MeshPrimitive): number {
  return getPrimitiveGeometry(primitive).triangleCount;
}
