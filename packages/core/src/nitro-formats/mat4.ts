/** A tiny column-major 4x4 matrix helper, just enough to flatten a decoded NSBMD's bone hierarchy into world-space vertex positions for `write-obj.ts` (OBJ has no bones of its own). */
export type Mat4 = Float64Array; // 16 entries, column-major: [m00,m10,m20,m30, m01,m11,...]

export function identity(): Mat4 {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** A TRS matrix from a 3x3 rotation (column-major, 9 entries) and a position/scale -- the same shape `decode-nsbmd.ts`'s `DecodedBone` already has. */
export function fromTrs(position: { x: number; y: number; z: number }, rotation: readonly number[], scale: { x: number; y: number; z: number }): Mat4 {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;
  return new Float64Array([
    r0 * scale.x, r1 * scale.x, r2 * scale.x, 0,
    r3 * scale.y, r4 * scale.y, r5 * scale.y, 0,
    r6 * scale.z, r7 * scale.z, r8 * scale.z, 0,
    position.x, position.y, position.z, 1
  ]);
}

/** `a * b` (apply `b` first, then `a` -- the usual "parent * child" composition order). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function applyToPoint(m: Mat4, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
  };
}

/** A column-major 3x3 rotation matrix (the same layout `decode-nsbmd.ts`'s `DecodedBone.rotation` uses) to a glTF-style quaternion [x, y, z, w]. Standard, well-documented algorithm, not Nintendo-specific. */
export function mat3ToQuaternion(m: readonly number[]): [number, number, number, number] {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}
