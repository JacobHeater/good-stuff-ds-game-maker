/**
 * Conversions to the Nintendo DS's number formats (see libnds `videoGL.h`). All are done here, in
 * TypeScript, so they're deterministic and testable; the C runtime never converts.
 *
 * - `f32`  20.12 fixed point in an int32. Matrices and positions. 1.0 = 4096.
 * - `v16`   4.12 fixed point in an int16. Vertex coordinates; roughly ±8 (that's the geometry
 *           engine's vertex format, which is why primitives are unit-sized and the matrix does the rest).
 * - `v10`   .9 fixed point in a 10-bit field. Normals and light directions: -512..511 covers -1..~1.
 * - `rgb15` 5 bits per channel, red in the low bits.
 */

export const FIXED_ONE = 1 << 12;

const F32_MIN = -(2 ** 31);
const F32_MAX = 2 ** 31 - 1;
const V16_MIN = -(2 ** 15);
const V16_MAX = 2 ** 15 - 1;

/** A value that can't be represented in the target DS format. */
export class FixedPointRangeError extends Error {
  constructor(
    public readonly format: "f32" | "v16",
    public readonly value: number
  ) {
    super(`${value} does not fit the DS ${format} format`);
    this.name = "FixedPointRangeError";
  }
}

export function toF32(value: number): number {
  const fixed = Math.round(value * FIXED_ONE);
  if (!Number.isFinite(fixed) || fixed < F32_MIN || fixed > F32_MAX) throw new FixedPointRangeError("f32", value);
  return fixed + 0; // + 0 turns -0 into 0, so equal scenes compare and print equal
}

export function toV16(value: number): number {
  const fixed = Math.round(value * FIXED_ONE);
  if (!Number.isFinite(fixed) || fixed < V16_MIN || fixed > V16_MAX) throw new FixedPointRangeError("v16", value);
  return fixed + 0;
}

/** -1..1 to the DS's 10-bit signed fraction, clamped (1.0 itself isn't representable; it becomes 511/512). */
export function toV10(value: number): number {
  return Math.max(-512, Math.min(511, Math.round(value * 512))) + 0;
}

/** Three v10 components packed into the 32-bit word `glNormal` takes (x low, then y, then z). */
export function packNormal(x: number, y: number, z: number): number {
  return ((toV10(x) & 0x3ff) | ((toV10(y) & 0x3ff) << 10) | ((toV10(z) & 0x3ff) << 20)) >>> 0;
}

export function rgb15(r: number, g: number, b: number): number {
  return (r & 31) | ((g & 31) << 5) | ((b & 31) << 10);
}

/** Inverse of `packNormal`, for tests: back to three numbers in -1..1. */
export function unpackNormal(packed: number): [number, number, number] {
  const field = (shift: number): number => {
    const raw = (packed >>> shift) & 0x3ff;
    return (raw >= 512 ? raw - 1024 : raw) / 512;
  };
  return [field(0), field(10), field(20)];
}
