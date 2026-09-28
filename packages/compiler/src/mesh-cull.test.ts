import { type MeshCullMode, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.mesh-face-culling.md: which side(s) of a mesh's triangles are drawn. */

function withCull(project: ProjectSnapshot, name: string, cull: MeshCullMode): ProjectSnapshot {
  const mark = (node: SceneNode): SceneNode => ({ ...node, ...(node.name === name && node.mesh ? { mesh: { ...node.mesh, cull } } : {}), children: node.children.map(mark) });
  return { ...project, scene: mark(project.scene) };
}

describe("a mesh's face culling", () => {
  it("defaults to none (both sides), and can be set to back or front", () => {
    const { scene } = translateScene3D(primitivesProject());
    expect(scene!.meshes.every((m) => m.cull === "none")).toBe(true);

    const backed = translateScene3D(withCull(primitivesProject(), "Cube", "back")).scene!;
    const byNode = (scene2: typeof backed, name: string) => scene2.meshes.find((m) => scene2.nodes[m.node].name === name)!;
    expect(byNode(backed, "Cube").cull).toBe("back");
    expect(byNode(backed, "Sphere").cull).toBe("none"); // untouched meshes keep the default

    const fronted = translateScene3D(withCull(primitivesProject(), "Cube", "front")).scene!;
    expect(byNode(fronted, "Cube").cull).toBe("front");
  });

  it("is emitted as the GsMesh struct's own field in the generated C", () => {
    const cullCodeOf = (cull: MeshCullMode): string => {
      const { scene } = translateScene3D(withCull(primitivesProject(), "Cube", cull));
      const cubeIndex = scene!.meshes.findIndex((m) => scene!.nodes[m.node].name === "Cube");
      const c = writeSceneDataC(scene!);
      const rows = c.match(/static const GsMesh meshes\[\] = \{\n([\s\S]*?)\n\};/)![1].split("\n");
      // cull is second-from-last now (alpha, always 31 here, is the trailing field).
      return rows[cubeIndex].trim().replace(/[},]+$/, "").trim().split(",").at(-2)!.trim();
    };
    expect(cullCodeOf("none")).toBe("0");
    expect(cullCodeOf("back")).toBe("1");
    expect(cullCodeOf("front")).toBe("2");
  });
});
