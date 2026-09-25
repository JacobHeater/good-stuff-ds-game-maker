import { boundRadius, clearance, type PlacedShape, type ShapeKind } from "./collision-oracle";

/**
 * Pairs of collision shapes to check: hand-worked cases whose answers were worked out on paper, and seeded random ones whose answers come from
 * the independent oracle (collision-oracle.ts). Used by the oracle's own test and by the DS test (collision.rom.test.ts).
 */

const ONE = 4096;
const fixed = (x: number): number => Math.round(x * ONE);

type Vec = [number, number, number];
type Mat = [[number, number, number], [number, number, number], [number, number, number]];

/** Rotation about X, then Y, then Z, in degrees: the order the editor and the runtime use (three.js's XYZ Euler). */
export function eulerMatrix([x, y, z]: Vec): Mat {
  const [a, b, c] = [x, y, z].map((v) => (v * Math.PI) / 180);
  const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb]
  ];
}

export interface Placement {
  /** Degrees (X, Y, Z). */
  rotation?: Vec;
  scale?: Vec;
  center?: Vec;
}

/** A shape with its sizes in world units, placed; everything is rounded to the DS's 20.12. `sizes` are as `PlacedShape.p` says, in world units. */
export function place(shape: ShapeKind, sizes: Vec, placement: Placement = {}): PlacedShape {
  const m = eulerMatrix(placement.rotation ?? [0, 0, 0]);
  return {
    shape,
    p: sizes.map(fixed) as Vec,
    rotation: m.map((row) => row.map(fixed)) as PlacedShape["rotation"],
    scale: (placement.scale ?? [1, 1, 1]).map(fixed) as Vec,
    center: (placement.center ?? [0, 0, 0]).map(fixed) as Vec
  };
}

// Handy sizes: a unit box (half extents 0.5), a sphere of radius 0.5, a capsule and a cylinder of radius 0.5 and total height 2.
const box = (placement?: Placement): PlacedShape => place("box", [0.5, 0.5, 0.5], placement);
const sphere = (radius: number, placement?: Placement): PlacedShape => place("sphere", [radius, 0, 0], placement);
const capsule = (placement?: Placement): PlacedShape => place("capsule", [0.5, 0.5, 0], placement); // radius 0.5, straight part 1 (2 in all)
const cylinder = (placement?: Placement): PlacedShape => place("cylinder", [0.5, 1, 0], placement); // radius 0.5, half height 1

export interface Pair {
  name: string;
  a: PlacedShape;
  b: PlacedShape;
}
export interface WorkedCase extends Pair {
  /** Whether they overlap, worked out by hand. */
  expected: boolean;
}

const at = (x: number, y = 0, z = 0): Placement => ({ center: [x, y, z] });

/** Answers worked out by hand (the reasoning is in each name). Every case is at least 0.04 from touching. */
export const WORKED_CASES: WorkedCase[] = [
  { name: "two unit boxes 0.9 apart overlap (they reach 1.0)", a: box(), b: box(at(0.9)), expected: true },
  { name: "two unit boxes 1.1 apart don't", a: box(), b: box(at(1.1)), expected: false },
  { name: "a box diagonal to another overlaps only inside 1.0 on the diagonal too (0.95, 0.95, 0 is inside both ranges)", a: box(), b: box(at(0.95, 0.95)), expected: true },
  { name: "a box just past the corner of another does not (1.05, 1.05, 0)", a: box(), b: box(at(1.05, 1.05)), expected: false },
  { name: "a box turned 45 degrees reaches 0.7071: overlaps at 1.15 (0.5 + 0.7071 = 1.2071)", a: box(), b: box({ rotation: [0, 0, 45], center: [1.15, 0, 0] }), expected: true },
  { name: "the same box turned 45 degrees doesn't at 1.25", a: box(), b: box({ rotation: [0, 0, 45], center: [1.25, 0, 0] }), expected: false },
  { name: "a box turned 45 degrees about Y reaches the same along X", a: box(), b: box({ rotation: [0, 45, 0], center: [1.15, 0, 0] }), expected: true },
  { name: "two boxes turned 45 degrees each way: corners toward each other, 1.35 apart overlap (0.7071 * 2 = 1.414)", a: box({ rotation: [0, 0, 45] }), b: box({ rotation: [0, 0, 45], center: [1.35, 0, 0] }), expected: true },
  { name: "and 1.5 apart they don't", a: box({ rotation: [0, 0, 45] }), b: box({ rotation: [0, 0, 45], center: [1.5, 0, 0] }), expected: false },
  { name: "a long thin box crosses a box it is not near the middle of", a: place("box", [2, 0.1, 0.1]), b: box(at(1.8, 0.3)), expected: true },
  { name: "a long thin box passes just above a box (0.1 + 0.5 = 0.6 < 0.7)", a: place("box", [2, 0.1, 0.1]), b: box(at(1.8, 0.7)), expected: false },
  { name: "two spheres of 0.5 and 0.7 overlap at 1.15", a: sphere(0.5), b: sphere(0.7, at(1.15)), expected: true },
  { name: "and don't at 1.25", a: sphere(0.5), b: sphere(0.7, at(1.25)), expected: false },
  { name: "a sphere against a box's face: 0.95 overlaps, 1.05 doesn't (0.5 + 0.5)", a: box(), b: sphere(0.5, at(0.95)), expected: true },
  { name: "1.05 doesn't", a: box(), b: sphere(0.5, at(1.05)), expected: false },
  { name: "a sphere near a box's corner: (0.8, 0.8, 0) is 0.424 from the corner, inside 0.5", a: box(), b: sphere(0.5, at(0.8, 0.8)), expected: true },
  { name: "(0.9, 0.9, 0) is 0.566 from the corner, outside 0.5, though inside the box's bounding sphere", a: box(), b: sphere(0.5, at(0.9, 0.9)), expected: false },
  { name: "a small sphere inside a big box overlaps", a: place("box", [3, 3, 3]), b: sphere(0.2, at(1, -1, 0.5)), expected: true },
  { name: "identical shapes on top of each other overlap", a: capsule(), b: capsule(), expected: true },
  { name: "a capsule and a sphere above it: 1.4 from the middle, 0.9 from the end of the straight part (< 1.0)", a: capsule(), b: sphere(0.5, at(0, 1.4)), expected: true },
  { name: "1.6 is 1.1 from the end of the straight part (> 1.0)", a: capsule(), b: sphere(0.5, at(0, 1.6)), expected: false },
  { name: "a capsule and a sphere beside it: 0.9 (< 1.0) overlaps", a: capsule(), b: sphere(0.5, at(0.9)), expected: true },
  { name: "1.1 doesn't", a: capsule(), b: sphere(0.5, at(1.1)), expected: false },
  { name: "two capsules crossed like an X, 0.9 apart in Z, overlap (0.5 + 0.5 = 1.0)", a: capsule(), b: capsule({ rotation: [0, 0, 90], center: [0, 0, 0.9] }), expected: true },
  { name: "1.1 apart they don't", a: capsule(), b: capsule({ rotation: [0, 0, 90], center: [0, 0, 1.1] }), expected: false },
  { name: "a cylinder and a box beside it: 0.95 overlaps (0.5 + 0.5)", a: cylinder(), b: box(at(0.95)), expected: true },
  { name: "1.05 doesn't", a: cylinder(), b: box(at(1.05)), expected: false },
  { name: "a box on top of a cylinder: 1.45 overlaps (1 + 0.5), 1.55 doesn't", a: cylinder(), b: box(at(0, 1.45)), expected: true },
  { name: "1.55 doesn't", a: cylinder(), b: box(at(0, 1.55)), expected: false },
  { name: "a cylinder lying along Z (turned 90 degrees about X): a box 1.45 along Z overlaps", a: cylinder({ rotation: [90, 0, 0] }), b: box(at(0, 0, 1.45)), expected: true },
  { name: "1.55 along Z doesn't", a: cylinder({ rotation: [90, 0, 0] }), b: box(at(0, 0, 1.55)), expected: false },
  { name: "the same lying cylinder is only 0.5 wide: a box 0.95 above it overlaps", a: cylinder({ rotation: [90, 0, 0] }), b: box(at(0, 0.95)), expected: true },
  { name: "and 1.05 above it doesn't", a: cylinder({ rotation: [90, 0, 0] }), b: box(at(0, 1.05)), expected: false },
  { name: "two cylinders side by side: 0.95 overlaps, 1.05 doesn't", a: cylinder(), b: cylinder(at(0.95)), expected: true },
  { name: "1.05 doesn't", a: cylinder(), b: cylinder(at(1.05)), expected: false },
  { name: "a cylinder and a sphere over its rim: the sphere at (0.8, 1.3, 0) is 0.3 out and 0.3 up from the rim (0.42 away, under 0.5): overlaps", a: cylinder(), b: sphere(0.5, at(0.8, 1.3)), expected: true },
  { name: "a sphere at (0.9, 1.4, 0) is 0.4 out and 0.4 up (0.57 away, over 0.5): doesn't", a: cylinder(), b: sphere(0.5, at(0.9, 1.4)), expected: false },
  { name: "and at (1.2, 1.6, 0), 0.7 out and 0.6 up (0.92 away, more than 0.5), doesn't", a: cylinder(), b: sphere(0.5, at(1.2, 1.6)), expected: false },
  { name: "a sphere scaled 2 along X is an ellipsoid reaching 1.0: a sphere of 0.5 at 1.45 overlaps", a: sphere(0.5, { scale: [2, 1, 1] }), b: sphere(0.5, at(1.45)), expected: true },
  { name: "at 1.55 it doesn't", a: sphere(0.5, { scale: [2, 1, 1] }), b: sphere(0.5, at(1.55)), expected: false },
  { name: "along Y that ellipsoid only reaches 0.5: a sphere of 0.5 at 0.95 overlaps", a: sphere(0.5, { scale: [2, 1, 1] }), b: sphere(0.5, at(0, 0.95)), expected: true },
  { name: "and at 1.05 doesn't", a: sphere(0.5, { scale: [2, 1, 1] }), b: sphere(0.5, at(0, 1.05)), expected: false },
  { name: "the scaled ellipsoid turned 90 degrees about Z reaches 1.0 along Y instead", a: sphere(0.5, { scale: [2, 1, 1], rotation: [0, 0, 90] }), b: sphere(0.5, at(0, 1.45)), expected: true },
  { name: "and only 0.5 along X", a: sphere(0.5, { scale: [2, 1, 1], rotation: [0, 0, 90] }), b: sphere(0.5, at(1.05)), expected: false },
  { name: "a box scaled to 3 wide reaches 1.5: another box at 1.95 overlaps, at 2.05 doesn't", a: box({ scale: [3, 1, 1] }), b: box(at(1.95)), expected: true },
  { name: "at 2.05 it doesn't", a: box({ scale: [3, 1, 1] }), b: box(at(2.05)), expected: false },
  { name: "a mirrored box (scale -1 on X) is the same box", a: box({ scale: [-1, 1, 1] }), b: box(at(0.9)), expected: true },
  { name: "a mirrored capsule beside a sphere: same answer as unmirrored", a: capsule({ scale: [-1, 1, 1] }), b: sphere(0.5, at(1.1)), expected: false },
  { name: "shapes far apart don't overlap (a bounding sphere test settles it)", a: sphere(0.5), b: sphere(0.5, at(50, 50, 50)), expected: false },
  { name: "a box inside a bigger scaled box overlaps", a: box({ scale: [4, 4, 4] }), b: box(at(0.5, 0.5, 0.5)), expected: true },
  { name: "a capsule leaning 45 degrees over a box: its end at (0.35, 0.35) from the middle reaches into a box at (1.0, 1.0)", a: capsule({ rotation: [0, 0, -45] }), b: box(at(1.0, 1.0)), expected: true },
  { name: "the same capsule doesn't reach a box at (1.4, 1.4)", a: capsule({ rotation: [0, 0, -45] }), b: box(at(1.4, 1.4)), expected: false }
];

export interface RandomCase extends Pair {
  /** From the oracle: the signed clearance in world units (positive = overlapping). */
  clearance: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded random pairs of shapes at random rotations (a quarter of the turns are multiples of 45 degrees, which makes the exact ties that
 * axis-aligned shapes produce) and uneven scales, at distances around touching, keeping only those the oracle says are clearly one thing or the
 * other: at least 3% of the smaller shape's size and 0.03 units from touching, more than the DS's fixed-point resolution.
 */
export function randomCases(kindA: ShapeKind, kindB: ShapeKind, count: number, seed: number, sizeFactor = 1): RandomCase[] {
  const rng = mulberry32(seed);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rng();
  const angle = (): number => (rng() < 0.4 ? Math.floor(rng() * 8) * 45 : between(0, 360));
  const shape = (kind: ShapeKind): PlacedShape => {
    const sizes: Record<ShapeKind, Vec> = {
      box: [between(0.15, 0.9), between(0.15, 0.9), between(0.15, 0.9)],
      sphere: [between(0.2, 1), 0, 0],
      capsule: [between(0.15, 0.6), between(0, 0.8), 0],
      cylinder: [between(0.2, 0.8), between(0.2, 1), 0]
    };
    const scale: Vec = [between(0.6, 1.6), between(0.6, 1.6), between(0.6, 1.6)];
    if (rng() < 0.1) scale[Math.floor(rng() * 3)] *= -1;
    if (rng() < 0.3) scale[0] = scale[1] = scale[2] = 1;
    return place(kind, sizes[kind].map((v) => v * sizeFactor) as Vec, { rotation: [angle(), angle(), angle()], scale });
  };
  const out: RandomCase[] = [];
  let tries = 0;
  let wantOverlap = true;
  while (out.length < count && tries++ < count * 400) {
    const a = shape(kindA);
    const b = shape(kindB);
    // Alternate the two outcomes, so a run has both in about equal numbers whatever the shapes.
    const reach = boundRadius(a) + boundRadius(b);
    const direction: Vec = rng() < 0.3 ? ([[1, 0, 0], [0, 1, 0], [0, 0, 1]][Math.floor(rng() * 3)] as Vec) : normalize([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    const distance = reach * (wantOverlap ? between(0.05, 0.75) : between(0.35, 1.1));
    b.center = direction.map((v) => fixed(v * distance)) as Vec;
    const c = clearance(a, b);
    const margin = Math.max(0.03 * Math.min(1, sizeFactor), 0.03 * Math.min(boundRadius(a), boundRadius(b)));
    if (Math.abs(c) < margin) continue;
    if (c > 0 !== wantOverlap) continue;
    out.push({ name: `${kindA} vs ${kindB} #${out.length}`, a, b, clearance: c });
    wantOverlap = !wantOverlap;
  }
  return out;
}

function normalize(v: Vec): Vec {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
