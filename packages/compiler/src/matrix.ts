import type { Vector3 } from "@goodstuff/core";

/**
 * 4x4 matrices as 16 numbers in **column-major** order (element [column * 4 + row]), the layout
 * OpenGL uses and the one the DS geometry engine reads. A point transforms as `M · p`, and
 * `multiply(a, b)` is the matrix `a · b`, i.e. `b` applies first.
 */
export type Mat4 = readonly number[];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Rotation from Euler angles in degrees, in three.js's default `XYZ` order: `Rx · Ry · Rz`, so a
 * point is rotated about Z first, then Y, then X. This is what the editor viewport draws, so the
 * compiler must match it exactly (checked against three.js in the tests).
 */
export function rotationFromEulerXYZ(degrees: Vector3): Mat4 {
  const [a, b, c] = [degrees.x * DEG_TO_RAD, degrees.y * DEG_TO_RAD, degrees.z * DEG_TO_RAD];
  const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  const rx: Mat4 = [1, 0, 0, 0, 0, ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1];
  const ry: Mat4 = [cb, 0, -sb, 0, 0, 1, 0, 0, sb, 0, cb, 0, 0, 0, 0, 1];
  const rz: Mat4 = [cc, sc, 0, 0, -sc, cc, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return multiply(rx, multiply(ry, rz));
}

/** `T · R · S`: scale first, then rotate, then translate — the same order three.js composes a node's transform. */
export function composeTransform(position: Vector3, rotationDegrees: Vector3, scale: Vector3): Mat4 {
  const r = rotationFromEulerXYZ(rotationDegrees);
  const out = [...r];
  for (let i = 0; i < 3; i++) {
    out[0 + i] *= scale.x;
    out[4 + i] *= scale.y;
    out[8 + i] *= scale.z;
  }
  out[12] = position.x;
  out[13] = position.y;
  out[14] = position.z;
  return out;
}

/** Inverse of a matrix whose last row is (0, 0, 0, 1) — any combination of translate, rotate and scale. */
export function invertAffine(m: Mat4): Mat4 {
  // Invert the upper 3x3 by cofactors, then the translation is -A⁻¹ · t.
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // rows of the 3x3
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("Cannot invert a singular transform (a zero scale?)");
  const inv = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det
  ]; // row-major 3x3
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  return [
    inv[0], inv[3], inv[6], 0,
    inv[1], inv[4], inv[7], 0,
    inv[2], inv[5], inv[8], 0,
    -(inv[0] * tx + inv[1] * ty + inv[2] * tz),
    -(inv[3] * tx + inv[4] * ty + inv[5] * tz),
    -(inv[6] * tx + inv[7] * ty + inv[8] * tz),
    1
  ];
}

/** The world-space direction a transform's local axis points in, normalized (scale removed). */
export function axisDirection(m: Mat4, axis: "x" | "y" | "z"): [number, number, number] {
  const o = axis === "x" ? 0 : axis === "y" ? 4 : 8;
  const v: [number, number, number] = [m[o], m[o + 1], m[o + 2]];
  const len = Math.hypot(...v);
  return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

/** The same transform with its scale removed, keeping rotation and translation. Cameras aren't scaled. */
export function withoutScale(m: Mat4): Mat4 {
  const x = axisDirection(m, "x");
  const y = axisDirection(m, "y");
  const z = axisDirection(m, "z");
  return [...x, 0, ...y, 0, ...z, 0, m[12], m[13], m[14], 1];
}

/**
 * Splits an affine transform into a rotation-and-translation matrix and a per-axis scale, so that `rigid * diag(scale)`
 * is `m`. The DS needs this: its geometry engine transforms a normal by the same matrix as a position and never
 * renormalizes it, so a matrix that carries scale makes normals longer or shorter and wrecks the lighting. The runtime
 * therefore loads `rigid` for both, and applies `scale` to positions only
 * (requirements/compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md).
 *
 * The scales are the lengths of the matrix's three axes. A mirrored transform (negative determinant) gets a negative
 * x scale, so `rigid` is always a proper rotation. Shear (a non-uniformly scaled parent above a rotated child) can't be
 * expressed as rotation times scale; it is approximated by the axes' lengths and directions.
 */
export function splitScale(m: Mat4): { rigid: Mat4; scale: [number, number, number] } {
  const axes = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]]
  ] as Array<[number, number, number]>;
  const lengths = axes.map((a) => Math.hypot(a[0], a[1], a[2]));
  // A collapsed axis (scale 0) has no direction; fall back to the world axis so `rigid` stays a rotation.
  const units = axes.map((a, i) => (lengths[i] > 1e-12 ? ([a[0] / lengths[i], a[1] / lengths[i], a[2] / lengths[i]] as [number, number, number]) : ((i === 0 ? [1, 0, 0] : i === 1 ? [0, 1, 0] : [0, 0, 1]) as [number, number, number])));
  const [x, y, z] = units;
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  const scale: [number, number, number] = [lengths[0], lengths[1], lengths[2]];
  if (determinant < 0) {
    scale[0] = -scale[0];
    x[0] = -x[0];
    x[1] = -x[1];
    x[2] = -x[2];
  }
  return { rigid: [...x, 0, ...y, 0, ...z, 0, m[12], m[13], m[14], 1], scale };
}

/** Euler angles (degrees, XYZ order) that produce the rotation part of `m`. The inverse of `rotationFromEulerXYZ`. */
export function eulerXYZFromRotation(m: Mat4): { x: number; y: number; z: number } {
  const m11 = m[0];
  const m12 = m[4];
  const m13 = m[8];
  const m22 = m[5];
  const m23 = m[9];
  const m32 = m[6];
  const m33 = m[10];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  const deg = 180 / Math.PI;
  return { x: x * deg, y: y * deg, z: z * deg };
}

/**
 * The Euler rotation (degrees, XYZ) that makes something at `eye` face `target` along its local -Z,
 * the way a camera (or a directional light) points. `up` says which way is up.
 */
export function lookAtEulerXYZ(
  eye: Vector3,
  target: Vector3,
  up: Vector3 = { x: 0, y: 1, z: 0 }
): { x: number; y: number; z: number } {
  const norm = (v: [number, number, number]): [number, number, number] => {
    const len = Math.hypot(...v);
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const crossV = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const z = norm([eye.x - target.x, eye.y - target.y, eye.z - target.z]);
  const x = norm(crossV([up.x, up.y, up.z], z));
  const y = crossV(z, x);
  return eulerXYZFromRotation([...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1]);
}
