import { createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

const sky = (name: string, topColor?: string, horizonColor?: string, distance?: number, skyCurrent?: boolean) => {
  const node = createSceneNode({ name, kind: "SkyBox3D" });
  if (topColor !== undefined || horizonColor !== undefined || distance !== undefined || skyCurrent !== undefined) {
    node.skyBox = { topColor, horizonColor, distance, current: skyCurrent };
  }
  return node;
};

describe("SkyBox3D becomes the scene's own gradient colors", () => {
  it("is empty for a scene with no SkyBox3D, same as before this existed", () => {
    expect(translateScene3D(cubeProject()).scene!.skyBoxes).toEqual([]);
  });

  it("carries its two colors as RGB15, by its own node", () => {
    const project = cubeProject();
    project.scene.children.push(sky("Sky", "#ff0000", "#0000ff", 3));
    const scene = translateScene3D(project).scene!;
    expect(scene.skyBoxes).toHaveLength(1);
    const entry = scene.skyBoxes[0];
    expect(scene.nodes[entry.node].name).toBe("Sky");
    expect(entry.topColor).toBe((0 << 10) | (0 << 5) | 31);
    expect(entry.horizonColor).toBe((31 << 10) | (0 << 5) | 0);
  });

  it("defaults an unsaved color to the same default the Inspector shows", () => {
    const project = cubeProject();
    project.scene.children.push(sky("Sky")); // no skyBox data at all: DEFAULT_SKY_BOX
    const scene = translateScene3D(project).scene!;
    expect(scene.skyBoxes).toHaveLength(1);
    // #2f6fb0 -> levels (6, 13, 21); #cfe9ff -> levels (25, 28, 31) -- rounded 8-bit-to-31-level conversion (parseMeshColor).
    const levels = (rgb15: number): number[] => [rgb15 & 31, (rgb15 >> 5) & 31, (rgb15 >> 10) & 31];
    expect(levels(scene.skyBoxes[0].topColor)).toEqual([6, 13, 21]);
    expect(levels(scene.skyBoxes[0].horizonColor)).toEqual([25, 28, 31]);
  });

  it("compiles every SkyBox3D in the scene, not just one, with no warning -- a day/night cycle's own usual shape", () => {
    const project = cubeProject();
    project.scene.children.push(sky("Day", "#ff0000", "#0000ff"), sky("Night", "#00ff00", "#ffffff"));
    const result = translateScene3D(project);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene!.skyBoxes).toHaveLength(2);
    expect(result.scene!.nodes[result.scene!.skyBoxes[0].node].name).toBe("Day");
    expect(result.scene!.nodes[result.scene!.skyBoxes[1].node].name).toBe("Night");
  });

  it("puts the one marked current first, even when it isn't first in the tree", () => {
    const project = cubeProject();
    project.scene.children.push(sky("Day", "#ff0000", "#0000ff"), sky("Night", "#00ff00", "#ffffff", undefined, true));
    const scene = translateScene3D(project).scene!;
    expect(scene.nodes[scene.skyBoxes[0].node].name).toBe("Night"); // marked current, so first despite being second in the tree
    expect(scene.nodes[scene.skyBoxes[1].node].name).toBe("Day");
  });

  it("with none marked current, puts the first one in the tree first (the same fallback Camera3D's own current uses)", () => {
    const project = cubeProject();
    project.scene.children.push(sky("Day", "#ff0000", "#0000ff"), sky("Night", "#00ff00", "#ffffff"));
    const scene = translateScene3D(project).scene!;
    expect(scene.nodes[scene.skyBoxes[0].node].name).toBe("Day");
  });

  it("writes the sky box fields into the generated C, in the no-sky-box case too", () => {
    const withoutSky = writeSceneDataC(translateScene3D(cubeProject()).scene!);
    expect(withoutSky).toMatch(/static const GsSkyBox sky_boxes\[\] = \{\n {2}\{ 0, 0, 0 \}\n\};/);
    expect(withoutSky).toMatch(/0, \/\* sky box count \*\//);

    const project = cubeProject();
    project.scene.children.push(sky("Sky", "#ff0000", "#0000ff"));
    const withSky = writeSceneDataC(translateScene3D(project).scene!);
    expect(withSky).toMatch(/static const GsSkyBox sky_boxes\[\] = \{\n {2}\{ \d+, 31, 31744 \}\n\};/);
    expect(withSky).toMatch(/1, \/\* sky box count \*\//);
  });
});
