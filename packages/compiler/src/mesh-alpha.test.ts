import { type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.mesh-transparency.md: a mesh's opacity, compiled to the DS's polygon alpha (0..31). */

function withAlpha(project: ProjectSnapshot, name: string, alpha: number): ProjectSnapshot {
  const mark = (node: SceneNode): SceneNode => ({ ...node, ...(node.name === name && node.mesh ? { mesh: { ...node.mesh, alpha } } : {}), children: node.children.map(mark) });
  return { ...project, scene: mark(project.scene) };
}

describe("a mesh's opacity", () => {
  it("defaults to fully opaque (31), and compiles a fraction to the DS's 31 levels", () => {
    const { scene } = translateScene3D(primitivesProject());
    expect(scene!.meshes.every((m) => m.alpha === 31)).toBe(true);

    const byNode = (s: typeof scene, name: string) => s!.meshes.find((m) => s!.nodes[m.node].name === name)!;
    expect(byNode(translateScene3D(withAlpha(primitivesProject(), "Cube", 0.5)).scene, "Cube").alpha).toBe(16);
    expect(byNode(translateScene3D(withAlpha(primitivesProject(), "Cube", 0)).scene, "Cube").alpha).toBe(0);
    expect(byNode(translateScene3D(withAlpha(primitivesProject(), "Cube", 1)).scene, "Cube").alpha).toBe(31);
    // untouched meshes keep the default
    expect(byNode(translateScene3D(withAlpha(primitivesProject(), "Cube", 0.5)).scene, "Sphere").alpha).toBe(31);
  });

  it("is emitted as the GsMesh struct's own trailing field in the generated C", () => {
    const { scene } = translateScene3D(withAlpha(primitivesProject(), "Cube", 0.5));
    const cubeIndex = scene!.meshes.findIndex((m) => scene!.nodes[m.node].name === "Cube");
    const c = writeSceneDataC(scene!);
    const rows = c.match(/static const GsMesh meshes\[\] = \{\n([\s\S]*?)\n\};/)![1].split("\n");
    const alphaOf = (row: string): string => row.trim().replace(/[},]+$/, "").trim().split(",").at(-1)!.trim();
    expect(alphaOf(rows[cubeIndex])).toBe("16");
  });
});
