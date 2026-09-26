import { createProjectSnapshot, createSceneNode, mergeMeshFrames, type ImportedMesh, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

/** requirements/scene-designer/STORY.animated-3d-models.md: a model's poses and a mesh's animations in the project file. */

const quad = (name: string, x0: number): ImportedMesh => ({ id: name, name, positions: [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] });
function project(): ProjectSnapshot {
  const merged = mergeMeshFrames([quad("a", 0), quad("b", 1)]);
  if (!merged.ok) throw new Error("should merge");
  const mesh = { ...createSceneNode({ name: "Hero", kind: "MeshInstance3D" }), mesh: { importedMeshId: "a", triangleCount: 1 }, spriteAnimations: { animations: [{ name: "walk", frames: [0, 1], fps: 8, loop: true }], start: "walk" } };
  return { ...createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [mesh] }) }), meshes: [merged.mesh] };
}

describe("poses and animated meshes in the project file", () => {
  it("save and reopen identically", () => {
    const original = project();
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(original)));
    expect(reopened.meshes![0].frames).toEqual(original.meshes![0].frames);
    expect(reopened.scene.children[0].spriteAnimations).toEqual(original.scene.children[0].spriteAnimations);
  });

  it("refuse a pose with a different number of vertices", () => {
    const bad = project();
    bad.meshes![0].frames = [{ positions: [0, 0, 0], normals: [0, 0, 1] }];
    const result = validator.validate(JSON.parse(serializer.serialize(bad)));
    expect(result.valid).toBe(false);
    expect([...result.issues].join(" ")).toMatch(/frames\/0 must have as many vertices/);
  });
});
