import { type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.unlit-meshes.md: a mesh can ignore the scene's lights and always show its own color at full brightness. */

function makeUnlit(project: ProjectSnapshot, name: string): ProjectSnapshot {
  const mark = (node: SceneNode): SceneNode => ({ ...node, ...(node.name === name && node.mesh ? { mesh: { ...node.mesh, unlit: true } } : {}), children: node.children.map(mark) });
  return { ...project, scene: mark(project.scene) };
}

describe("a mesh set to unlit", () => {
  it("compiles with unlit true; an ordinary mesh compiles with it false", () => {
    const { scene } = translateScene3D(makeUnlit(primitivesProject(), "Cube"));
    const byNode = (name: string) => scene!.meshes.find((m) => scene!.nodes[m.node].name === name)!;
    expect(byNode("Cube").unlit).toBe(true);
    expect(byNode("Sphere").unlit).toBe(false);
  });

  it("is emitted as the GsMesh struct's own flag in the generated C", () => {
    const { scene } = translateScene3D(makeUnlit(primitivesProject(), "Cube"));
    const cubeIndex = scene!.meshes.findIndex((m) => scene!.nodes[m.node].name === "Cube");
    const sphereIndex = scene!.meshes.findIndex((m) => scene!.nodes[m.node].name === "Sphere");
    const c = writeSceneDataC(scene!);
    const rows = c.match(/static const GsMesh meshes\[\] = \{\n([\s\S]*?)\n\};/)![1].split("\n");
    expect(rows[cubeIndex].trim().endsWith("1 }") || rows[cubeIndex].trim().endsWith("1 },")).toBe(true);
    expect(rows[sphereIndex].trim().endsWith("0 }") || rows[sphereIndex].trim().endsWith("0 },")).toBe(true);
  });
});
