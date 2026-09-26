import { describe, expect, it } from "vitest";

import { getImportedFrameCount, getImportedMeshFrameGeometry, getImportedMeshGeometry, mergeMeshFrames, type ImportedMesh } from "./imported-mesh";
import { getMeshFrameCount, resolveMeshFrameGeometry } from "./mesh-geometry";

/** requirements/scene-designer/STORY.animated-3d-models.md: a model with several poses. */

/** A quad facing +Z from x0 to x0 + 1. */
function quad(name: string, x0: number, extra: Partial<ImportedMesh> = {}): ImportedMesh {
  return {
    id: name,
    name,
    positions: [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    ...extra
  };
}

describe("putting models together as poses", () => {
  it("makes one model whose first pose is the first file, with the others as frames", () => {
    const merged = mergeMeshFrames([quad("walk1", 0), quad("walk2", 2), quad("walk3", 4)]);
    if (!merged.ok) throw new Error(merged.errors.join(" "));
    expect(merged.mesh.name).toBe("walk1");
    expect(getImportedFrameCount(merged.mesh)).toBe(3);
    expect(merged.mesh.frames).toHaveLength(2);
    expect(merged.mesh.positions[0]).toBe(0);
    expect(merged.mesh.frames![0].positions[0]).toBe(2);
    expect(merged.mesh.frames![1].positions[0]).toBe(4);
  });

  it("leaves a single model as it is (one pose, no frames)", () => {
    const merged = mergeMeshFrames([quad("a", 0)]);
    if (!merged.ok) throw new Error("should merge");
    expect(merged.mesh.frames).toBeUndefined();
    expect(getImportedFrameCount(merged.mesh)).toBe(1);
  });

  it("refuses models with different vertices, or different triangles, saying which", () => {
    const fewer = { ...quad("b", 0), positions: [0, 0, 0, 1, 0, 0, 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
    const flipped = quad("c", 0, { indices: [0, 2, 1, 0, 3, 2] });
    const a = mergeMeshFrames([quad("a", 0), fewer]);
    const b = mergeMeshFrames([quad("a", 0), flipped]);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.errors[0]).toMatch(/"b" has 3 vertices, but "a" has 4/);
    expect(!b.ok && b.errors[0]).toMatch(/"c" has different triangles from "a"/);
    expect(mergeMeshFrames([]).ok).toBe(false);
  });
});

describe("the triangles of each pose", () => {
  const merged = mergeMeshFrames([quad("a", 0), quad("b", 5)]);
  if (!merged.ok) throw new Error("should merge");
  const mesh = merged.mesh;

  it("come from the pose's own vertices with the model's own triangles", () => {
    expect(getImportedMeshFrameGeometry(mesh, 0)).toBe(getImportedMeshGeometry(mesh));
    const second = getImportedMeshFrameGeometry(mesh, 1);
    expect(second.triangleCount).toBe(2);
    expect(second.positions.slice(0, 3)).toEqual([5, 0, 0]);
    expect(second.positions.slice(3, 6)).toEqual([6, 0, 0]);
    expect(getImportedMeshFrameGeometry(mesh, 1)).toBe(second); // built once
    expect(getImportedMeshFrameGeometry(mesh, 7)).toBe(getImportedMeshGeometry(mesh)); // out of range: the first
  });

  it("are found through a mesh instance", () => {
    const instance = { importedMeshId: "a", triangleCount: 2 };
    expect(getMeshFrameCount(instance, [mesh])).toBe(2);
    expect(getMeshFrameCount({ primitive: "cube", triangleCount: 12 }, [mesh])).toBe(1);
    expect(resolveMeshFrameGeometry(instance, [mesh], 1)!.positions[0]).toBe(5);
  });
});
