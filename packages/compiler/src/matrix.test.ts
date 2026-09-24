import { Euler, Matrix4, Quaternion, Vector3 as ThreeVector3 } from "three";
import { describe, expect, it } from "vitest";

import { FixedPointRangeError, packNormal, toF32, toV10, toV16, unpackNormal } from "./fixed-point";
import {
  axisDirection,
  composeTransform,
  eulerXYZFromRotation,
  IDENTITY,
  invertAffine,
  lookAtEulerXYZ,
  multiply,
  rotationFromEulerXYZ,
  withoutScale,
  type Mat4
} from "./matrix";

/** Column-major elements straight out of three.js, the reference the editor viewport actually uses. */
function threeCompose(p: [number, number, number], rotDeg: [number, number, number], s: [number, number, number]): number[] {
  const q = new Quaternion().setFromEuler(new Euler(...rotDeg.map((d) => (d * Math.PI) / 180) as [number, number, number], "XYZ"));
  return new Matrix4().compose(new ThreeVector3(...p), q, new ThreeVector3(...s)).elements;
}

const close = (a: Mat4, b: readonly number[], digits = 9): void => {
  expect(a.length).toBe(16);
  for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], digits);
};

describe("matrix composition matches three.js, which is what the editor draws", () => {
  const cases: Array<[string, [number, number, number], [number, number, number], [number, number, number]]> = [
    ["identity", [0, 0, 0], [0, 0, 0], [1, 1, 1]],
    ["translation only", [1, -2, 3], [0, 0, 0], [1, 1, 1]],
    ["rotation about one axis", [0, 0, 0], [0, 90, 0], [1, 1, 1]],
    ["rotation about several axes (order matters)", [0, 0, 0], [30, 45, 60], [1, 1, 1]],
    ["everything at once", [2, 3, -4], [10, -75, 120], [2, 0.5, 3]]
  ];
  for (const [name, p, r, s] of cases) {
    it(name, () => {
      close(
        composeTransform({ x: p[0], y: p[1], z: p[2] }, { x: r[0], y: r[1], z: r[2] }, { x: s[0], y: s[1], z: s[2] }),
        threeCompose(p, r, s)
      );
    });
  }

  it("Euler XYZ is Rx·Ry·Rz, not Rz·Ry·Rx: a wrong order would be caught here", () => {
    const a = rotationFromEulerXYZ({ x: 30, y: 45, z: 60 });
    const wrong = multiply(
      rotationFromEulerXYZ({ x: 0, y: 0, z: 60 }),
      multiply(rotationFromEulerXYZ({ x: 0, y: 45, z: 0 }), rotationFromEulerXYZ({ x: 30, y: 0, z: 0 }))
    );
    expect(a.some((v, i) => Math.abs(v - wrong[i]) > 1e-6)).toBe(true);
  });

  it("composing through a parent equals three.js's own parent-child composition", () => {
    const parent = composeTransform({ x: 1, y: 2, z: 3 }, { x: 0, y: 90, z: 0 }, { x: 2, y: 2, z: 2 });
    const child = composeTransform({ x: 1, y: 0, z: 0 }, { x: 45, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const expected = new Matrix4()
      .fromArray(threeCompose([1, 2, 3], [0, 90, 0], [2, 2, 2]))
      .multiply(new Matrix4().fromArray(threeCompose([1, 0, 0], [45, 0, 0], [1, 1, 1])));
    close(multiply(parent, child), expected.elements);
  });
});

describe("invertAffine", () => {
  it("gives the inverse: M · M⁻¹ is the identity", () => {
    const m = composeTransform({ x: 5, y: -3, z: 2 }, { x: 20, y: 130, z: -40 }, { x: 2, y: 3, z: 0.5 });
    close(multiply(m, invertAffine(m)), IDENTITY);
    close(multiply(invertAffine(m), m), IDENTITY);
  });

  it("matches three.js's own inverse", () => {
    const e = threeCompose([5, -3, 2], [20, 130, -40], [1, 1, 1]);
    close(invertAffine(e), new Matrix4().fromArray(e).invert().elements);
  });

  it("refuses a singular transform rather than returning garbage", () => {
    expect(() => invertAffine(composeTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }))).toThrow();
  });
});

describe("withoutScale", () => {
  it("keeps rotation and translation and drops scale", () => {
    const m = composeTransform({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 }, { x: 4, y: 5, z: 6 });
    close(withoutScale(m), composeTransform({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 }, { x: 1, y: 1, z: 1 }));
  });
});

describe("DS fixed point", () => {
  it("converts to 20.12 and 4.12 exactly where it can", () => {
    expect(toF32(1)).toBe(4096);
    expect(toF32(-0.5)).toBe(-2048);
    expect(toV16(0.5)).toBe(2048);
  });

  it("round-trips to within 1/4096", () => {
    for (const x of [0.123456, -3.14159, 7.9, -7.99]) {
      expect(Math.abs(toV16(x) / 4096 - x)).toBeLessThanOrEqual(1 / 8192 + 1e-12);
      expect(Math.abs(toF32(x) / 4096 - x)).toBeLessThanOrEqual(1 / 8192 + 1e-12);
    }
  });

  it("reports a value that doesn't fit instead of wrapping it", () => {
    expect(() => toV16(8)).toThrow(FixedPointRangeError); // 4.12 tops out just under 8
    expect(() => toV16(-8.01)).toThrow(FixedPointRangeError);
    expect(() => toF32(2 ** 20)).toThrow(FixedPointRangeError);
    expect(() => toV16(NaN)).toThrow(FixedPointRangeError);
    expect(toV16(-8)).toBe(-32768);
  });

  it("packs normals into the DS's 10-bit fields and back", () => {
    expect(toV10(1)).toBe(511);
    expect(toV10(-1)).toBe(-512);
    const packed = packNormal(0, 1, 0);
    expect(packed).toBe((511 << 10) >>> 0);
    const [x, y, z] = unpackNormal(packNormal(0.6, -0.8, 0));
    expect(x).toBeCloseTo(0.6, 2);
    expect(y).toBeCloseTo(-0.8, 2);
    expect(z).toBeCloseTo(0, 2);
  });

  it("packs to an unsigned 32-bit value", () => {
    const n = packNormal(-1, -1, -1);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(2 ** 32);
  });
});

describe("aiming a camera", () => {
  it("eulerXYZFromRotation inverts rotationFromEulerXYZ", () => {
    for (const e of [{ x: 30, y: 45, z: 60 }, { x: -20, y: 10, z: 170 }, { x: 0, y: 0, z: 0 }]) {
      const back = eulerXYZFromRotation(rotationFromEulerXYZ(e));
      close(rotationFromEulerXYZ(back), rotationFromEulerXYZ(e));
    }
  });

  it("lookAtEulerXYZ points local -Z at the target, matching three.js's lookAt", () => {
    const eye = { x: 3, y: 2.5, z: 4 };
    const euler = lookAtEulerXYZ(eye, { x: 0, y: 0, z: 0 });
    const m = composeTransform(eye, euler, { x: 1, y: 1, z: 1 });
    // A camera looks along its local -Z, so its +Z axis points from the target back toward the eye.
    const [zx, zy, zz] = axisDirection(m, "z");
    const len = Math.hypot(3, 2.5, 4);
    expect(zx).toBeCloseTo(3 / len, 9);
    expect(zy).toBeCloseTo(2.5 / len, 9);
    expect(zz).toBeCloseTo(4 / len, 9);
    const three = new Matrix4().lookAt(new ThreeVector3(3, 2.5, 4), new ThreeVector3(0, 0, 0), new ThreeVector3(0, 1, 0));
    close(rotationFromEulerXYZ(euler), new Matrix4().extractRotation(three).elements);
  });

  it("a camera's view matrix puts the target straight ahead", () => {
    const eye = { x: 3, y: 2.5, z: 4 };
    const world = composeTransform(eye, lookAtEulerXYZ(eye, { x: 0, y: 0, z: 0 }), { x: 1, y: 1, z: 1 });
    const view = invertAffine(world);
    // the origin, seen from the camera: on the -Z axis, at the eye's distance
    const [x, y, z] = [view[12], view[13], view[14]];
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(-Math.hypot(3, 2.5, 4), 9);
  });
});

describe("negative zero", () => {
  it("never comes out of a DS conversion", () => {
    for (const convert of [toF32, toV16, toV10]) expect(Object.is(convert(-0), 0)).toBe(true);
    expect(Object.is(toV16(-0.00001), 0)).toBe(true); // rounds to zero from below
  });
});
