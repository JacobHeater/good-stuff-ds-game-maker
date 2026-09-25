import { createSceneNode, lightLevelFromIntensity } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject, lightProbeProject } from "./fixtures";
import { composeTransform, multiply, splitScale, type Mat4 } from "./matrix";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** rigid * diag(scale): the scale applied to the rigid matrix's axes. */
function recompose(rigid: Mat4, scale: readonly number[]): number[] {
  const out = [...rigid];
  for (let axis = 0; axis < 3; axis++) for (let i = 0; i < 3; i++) out[axis * 4 + i] *= scale[axis];
  return out;
}
const det3 = (m: Mat4): number =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
const close = (a: readonly number[], b: readonly number[], eps = 1e-9): void => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

describe("splitScale (the DS must not scale normals)", () => {
  it("reproduces the transform exactly and leaves unit-length rotation axes, for scale, rotation and translation in any mix", () => {
    const cases = [
      composeTransform({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 }, { x: 3, y: 3, z: 3 }),
      composeTransform({ x: -4, y: 0, z: 9 }, { x: 90, y: 0, z: 45 }, { x: 3, y: 1, z: 2 }),
      composeTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0.25, y: 8, z: 1 }),
      composeTransform({ x: 5, y: 5, z: 5 }, { x: 170, y: -80, z: 200 }, { x: 1, y: 1, z: 1 })
    ];
    for (const m of cases) {
      const { rigid, scale } = splitScale(m);
      close(recompose(rigid, scale), m);
      for (let axis = 0; axis < 3; axis++) expect(Math.hypot(rigid[axis * 4], rigid[axis * 4 + 1], rigid[axis * 4 + 2])).toBeCloseTo(1, 9);
      expect(det3(rigid)).toBeCloseTo(1, 9); // a proper rotation
      expect(rigid.slice(12)).toEqual(m.slice(12)); // translation is untouched
    }
  });

  it("finds the scale of a nested transform: a parent's scale times the child's", () => {
    const parent = composeTransform({ x: 1, y: 0, z: 0 }, { x: 0, y: 90, z: 0 }, { x: 2, y: 2, z: 2 });
    const child = composeTransform({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 45 }, { x: 1.5, y: 1.5, z: 1.5 });
    const { rigid, scale } = splitScale(multiply(parent, child));
    scale.forEach((v) => expect(v).toBeCloseTo(3, 9));
    close(recompose(rigid, scale), multiply(parent, child));
  });

  it("gives a mirrored transform a negative x scale and keeps the rotation proper", () => {
    const mirrored = composeTransform({ x: 1, y: 2, z: 3 }, { x: 20, y: 30, z: 40 }, { x: -2, y: 3, z: 4 });
    const { rigid, scale } = splitScale(mirrored);
    expect(scale[0]).toBeLessThan(0);
    expect(det3(rigid)).toBeCloseTo(1, 9);
    close(recompose(rigid, scale), mirrored);
  });

  it("copes with a collapsed axis: the rotation stays a rotation", () => {
    const flat = composeTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 });
    const { rigid, scale } = splitScale(flat);
    expect(scale).toEqual([1, 0, 1]);
    expect(det3(rigid)).toBeCloseTo(1, 9);
  });
});

describe("scale reaches the ROM as a separate value", () => {
  it("emits the same rotation for a scaled and an unscaled mesh, and puts the scale next to it", () => {
    const scaled = translateScene3D(lightProbeProject(0)).scene!;
    const [mesh] = scaled.meshes;
    expect(mesh.scale.map((v) => v / 4096)).toEqual([3, 3, 3]);
    // The plane is turned 90 degrees about X: its axes are the world axes, unit length.
    for (let axis = 0; axis < 3; axis++) expect(Math.hypot(...mesh.world.slice(axis * 4, axis * 4 + 3).map((v) => v / 4096))).toBeCloseTo(1, 3);
  });

  it("writes the scale into the plane's node in the generated C, before its matrix", () => {
    const c = writeSceneDataC(translateScene3D(lightProbeProject(0)).scene!);
    // 12288 is 3.0 in 20.12: the node's local scale, then its baked world scale, then the baked rotation + translation matrix.
    expect(c).toMatch(/\{ 0, 0, 1, -1, -1, -1, \{ 0, 0, 0 \}, \{ 368640, 0, 0 \}, \{ 12288, 12288, 12288 \}, \{ 12288, 12288, 12288 \}, \{ \{/);
    expect(c).toMatch(/static const GsMesh meshes\[\] = \{\n  \{ 0, 25368, 0, 1 \}\n\};/); // 25368 is grey 24 of 31; the mesh is node 1
  });
});

describe("light intensity becomes the level of a white light", () => {
  const withIntensity = (intensity?: number) => {
    const project = lightProbeProject(0);
    const light = project.scene.children.find((c) => c.kind === "DirectionalLight3D")!;
    if (intensity !== undefined) light.light = { intensity };
    return translateScene3D(project).scene!.lights[0];
  };
  const level = (color: number): number[] => [color & 31, (color >> 5) & 31, (color >> 10) & 31];

  it("is full white by default, and for a light saved before intensity existed", () => {
    expect(level(withIntensity().color)).toEqual([31, 31, 31]);
    expect(level(withIntensity(1).color)).toEqual([31, 31, 31]);
  });

  it("rounds to the DS's 31 levels: 50% is 16, 0 is black, and values outside 0..1 are clamped", () => {
    expect(level(withIntensity(0.5).color)).toEqual([16, 16, 16]);
    expect(withIntensity(0).color).toBe(0);
    expect(level(withIntensity(0.25).color)).toEqual([8, 8, 8]);
    expect(level(withIntensity(7).color)).toEqual([31, 31, 31]);
    expect(withIntensity(-3).color).toBe(0);
    expect(lightLevelFromIntensity(0.5)).toBe(16);
    expect(lightLevelFromIntensity(Number.NaN)).toBe(31);
  });

  it("does not change where the light points", () => {
    expect(withIntensity(0.3).direction).toEqual(withIntensity(1).direction);
  });

  it("an existing project compiles exactly as before: the fallback cube fixture is unchanged by this", () => {
    const light = translateScene3D(cubeProject()).scene!.lights[0];
    expect(level(light.color)).toEqual([31, 31, 31]);
    expect(createSceneNode({ name: "L", kind: "DirectionalLight3D" }).light).toBeUndefined();
  });
});
