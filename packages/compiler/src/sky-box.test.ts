import { createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

const sky = (topColor?: string, horizonColor?: string, distance?: number) => {
  const node = createSceneNode({ name: "Sky", kind: "SkyBox3D" });
  if (topColor !== undefined || horizonColor !== undefined || distance !== undefined) node.skyBox = { topColor, horizonColor, distance };
  return node;
};

describe("SkyBox3D becomes the scene's own gradient colors", () => {
  it("is null for a scene with no SkyBox3D, same as before this existed", () => {
    expect(translateScene3D(cubeProject()).scene!.skyBox).toBeNull();
  });

  it("carries its two colors as RGB15 and its distance, defaulted when not saved", () => {
    const project = cubeProject();
    project.scene.children.push(sky("#ff0000", "#0000ff", 3));
    const scene = translateScene3D(project).scene!;
    expect(scene.skyBox).toEqual({ topColor: (0 << 10) | (0 << 5) | 31, horizonColor: (31 << 10) | (0 << 5) | 0, distance: 3 });
  });

  it("defaults an unsaved color or distance to the same default the Inspector shows", () => {
    const project = cubeProject();
    project.scene.children.push(sky()); // no skyBox data at all: DEFAULT_SKY_BOX
    const scene = translateScene3D(project).scene!;
    expect(scene.skyBox).not.toBeNull();
    // #2f6fb0 -> levels (6, 13, 21); #cfe9ff -> levels (25, 28, 31) -- rounded 8-bit-to-31-level conversion (parseMeshColor).
    const levels = (rgb15: number): number[] => [rgb15 & 31, (rgb15 >> 5) & 31, (rgb15 >> 10) & 31];
    expect(levels(scene.skyBox!.topColor)).toEqual([6, 13, 21]);
    expect(levels(scene.skyBox!.horizonColor)).toEqual([25, 28, 31]);
    expect(scene.skyBox!.distance).toBe(7.5); // SKY_BOX_DISTANCE_MAX
  });

  it("clamps an out-of-range distance to 0.5..7.5 (a vertex's own v16 range)", () => {
    const project = cubeProject();
    project.scene.children.push(sky("#ff0000", "#0000ff", 50));
    expect(translateScene3D(project).scene!.skyBox!.distance).toBe(7.5);
    const project2 = cubeProject();
    project2.scene.children.push(sky("#ff0000", "#0000ff", -2));
    expect(translateScene3D(project2).scene!.skyBox!.distance).toBe(0.5);
  });

  it("warns and uses only the first when a scene somehow has more than one", () => {
    const project = cubeProject();
    project.scene.children.push(sky("#ff0000", "#0000ff"), sky("#00ff00", "#ffffff"));
    const result = translateScene3D(project);
    expect(result.diagnostics.some((d) => d.code === "multiple-sky-boxes")).toBe(true);
    expect(result.scene!.skyBox!.topColor).toBe((0 << 10) | (0 << 5) | 31); // the first one's red top, not the second's green
  });

  it("writes the sky box fields into the generated C, in the no-sky-box case too", () => {
    const withoutSky = writeSceneDataC(translateScene3D(cubeProject()).scene!);
    expect(withoutSky).toMatch(/0, 0, 0, 0\.0f, \/\* no sky box \*\//);

    const project = cubeProject();
    project.scene.children.push(sky("#ff0000", "#0000ff", 3));
    const withSky = writeSceneDataC(translateScene3D(project).scene!);
    expect(withSky).toMatch(/1, 31, 31744, 3\.0f, \/\* has sky box, top color, horizon color, distance \*\//);
  });
});
