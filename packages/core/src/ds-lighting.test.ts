import { describe, expect, it } from "vitest";

import { DS_AMBIENT, DS_MAX_LIGHTS, DS_PLAIN_MESH_DIFFUSE, dsVertexBrightness, lightLevelFromIntensity, type DsLightInput } from "./ds-lighting";
import { getLightIntensity } from "./scene-node";

/** A light travelling the way that meets a +Z-facing surface at `degrees` from straight on. */
const lightAt = (degrees: number, level = 31): DsLightInput => ({
  direction: [Math.sin((degrees * Math.PI) / 180), 0, -Math.cos((degrees * Math.PI) / 180)],
  level
});
const facingCamera: [number, number, number] = [0, 0, 1];

describe("the DS lighting model", () => {
  it("has the runtime's numbers: ambient 8/31 and a plain mesh's diffuse 24/31", () => {
    expect(DS_AMBIENT).toBeCloseTo(8 / 31, 12);
    expect(DS_PLAIN_MESH_DIFFUSE).toBeCloseTo(24 / 31, 12);
    expect(DS_MAX_LIGHTS).toBe(4);
  });

  it("is full brightness straight on, ambient only edge-on or facing away, and follows the cosine between", () => {
    expect(dsVertexBrightness(facingCamera, [lightAt(0)])).toBe(1); // 8/31 + 24/31 clamps to 1
    expect(dsVertexBrightness(facingCamera, [lightAt(90)])).toBeCloseTo(DS_AMBIENT, 9);
    expect(dsVertexBrightness(facingCamera, [lightAt(120)])).toBeCloseTo(DS_AMBIENT, 9); // behind the surface
    expect(dsVertexBrightness(facingCamera, [lightAt(60)])).toBeCloseTo(DS_AMBIENT + DS_PLAIN_MESH_DIFFUSE * 0.5, 9);
    expect(dsVertexBrightness(facingCamera, [lightAt(45)])).toBeCloseTo(DS_AMBIENT + DS_PLAIN_MESH_DIFFUSE * Math.SQRT1_2, 9);
  });

  it("scales the whole contribution, ambient included, by the light's color", () => {
    expect(dsVertexBrightness(facingCamera, [lightAt(90, 16)])).toBeCloseTo((16 / 31) * DS_AMBIENT, 9);
    expect(dsVertexBrightness(facingCamera, [lightAt(60, 16)])).toBeCloseTo((16 / 31) * (DS_AMBIENT + DS_PLAIN_MESH_DIFFUSE * 0.5), 9);
    expect(dsVertexBrightness(facingCamera, [lightAt(0, 0)])).toBe(0); // a light at 0 contributes nothing
  });

  it("adds lights together and clamps at full brightness; only the first four count", () => {
    const two = dsVertexBrightness(facingCamera, [lightAt(75, 10), lightAt(75, 10)]);
    expect(two).toBeCloseTo(2 * (10 / 31) * (DS_AMBIENT + DS_PLAIN_MESH_DIFFUSE * Math.cos((75 * Math.PI) / 180)), 9);
    expect(dsVertexBrightness(facingCamera, [lightAt(0), lightAt(0)])).toBe(1);
    const five = Array.from({ length: 5 }, () => lightAt(90, 4));
    expect(dsVertexBrightness(facingCamera, five)).toBeCloseTo(4 * (4 / 31) * DS_AMBIENT, 9); // the fifth adds nothing
  });

  it("uses the material's diffuse: white shows a texture in full where a plain mesh is grey", () => {
    expect(dsVertexBrightness(facingCamera, [lightAt(60)], 1)).toBeCloseTo(DS_AMBIENT + 0.5, 9);
  });

  it("with no lights nothing is lit: the mesh shows its own color at full brightness, not black", () => {
    expect(dsVertexBrightness(facingCamera, [])).toBeCloseTo(DS_PLAIN_MESH_DIFFUSE, 12);
    expect(dsVertexBrightness(facingCamera, [], 1)).toBe(1);
  });
});

describe("light intensity", () => {
  it("is the level of a white light: 31 steps, nothing brighter than full", () => {
    expect([0, 0.5, 1].map(lightLevelFromIntensity)).toEqual([0, 16, 31]);
    expect(lightLevelFromIntensity(1 / 31)).toBe(1);
    expect(lightLevelFromIntensity(2)).toBe(31);
    expect(lightLevelFromIntensity(-1)).toBe(0);
    expect(lightLevelFromIntensity(Number.POSITIVE_INFINITY)).toBe(31);
  });

  it("is 100% for a light that has none saved", () => {
    expect(getLightIntensity({})).toBe(1);
    expect(getLightIntensity({ light: { intensity: 0.4 } })).toBe(0.4);
    expect(getLightIntensity({ light: { intensity: 0 } })).toBe(0);
  });
});
