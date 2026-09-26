import { createSceneNode, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject, texturedPrimitivesProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.mesh-colors.md: a mesh's color reaches the ROM as its diffuse color (RGB15: red in the low five bits). */

const rgb15 = (r: number, g: number, b: number): number => r | (g << 5) | (b << 10);

function withColor(project: ProjectSnapshot, name: string, color: string): ProjectSnapshot {
  const paint = (node: SceneNode): SceneNode => ({ ...node, ...(node.name === name && node.mesh ? { mesh: { ...node.mesh, color } } : {}), children: node.children.map(paint) });
  return { ...project, scene: paint(project.scene) };
}

describe("mesh colors in the compiled scene", () => {
  it("a plain mesh with a color is drawn in it; one without is the DS's grey", () => {
    const { scene } = translateScene3D(withColor(primitivesProject(), "Cube", "#ff0000"));
    const byNode = (name: string) => scene!.meshes.find((m) => scene!.nodes[m.node].name === name)!.diffuse;
    expect(byNode("Cube")).toBe(rgb15(31, 0, 0));
    expect(byNode("Sphere")).toBe(rgb15(24, 24, 24));
  });

  it("a textured mesh is white unless it has a color, which then tints the texture", () => {
    const plain = translateScene3D(texturedPrimitivesProject());
    const white = plain.scene!.meshes.find((m) => m.texture > 0)!;
    expect(white.diffuse).toBe(rgb15(31, 31, 31));
    const nodeName = plain.scene!.nodes[white.node].name;
    const tinted = translateScene3D(withColor(texturedPrimitivesProject(), nodeName, "#0000ff"));
    expect(tinted.scene!.meshes.find((m) => m.texture > 0 && tinted.scene!.nodes[m.node].name === nodeName)!.diffuse).toBe(rgb15(0, 0, 31));
  });

  it("a color that isn't #rrggbb falls back to the default", () => {
    const { scene } = translateScene3D(withColor(primitivesProject(), "Cube", "red"));
    expect(scene!.meshes.find((m) => scene!.nodes[m.node].name === "Cube")!.diffuse).toBe(rgb15(24, 24, 24));
  });

  void createSceneNode;
});
