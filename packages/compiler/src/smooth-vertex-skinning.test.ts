import { buildArm, expandSceneInstances, flattenSceneTree, importGltf, type ProjectSnapshot, type RiggedModel } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

/** STORY.smooth-vertex-skinning.md: an opt-in weighted blend of every bone a mesh's real skin data weighs it to, instead of just the strongest one. */

function imported(): RiggedModel {
  const built = buildArm({ splitWeight: true });
  const r = importGltf({ json: built.json, buffers: [built.bin] }, "Robot");
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.model;
}

function riggedProject(model: RiggedModel): ProjectSnapshot {
  const base = primitivesProject();
  return { ...base, meshes: model.meshes, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), model.root] } };
}

function hipMeshNode(model: RiggedModel) {
  return flattenSceneTree(model.root).find((n) => n.name.includes("Hip_mesh"))!;
}

describe("smooth skinning in a compiled scene", () => {
  it("leaves a plain (non-toggled) mesh instance drawn rigidly: skinJointCount 0, even though the shared primitive still carries the model's own skin data", () => {
    const model = imported();
    const { scene, diagnostics } = translateScene3D(riggedProject(model));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const mesh = scene!.meshes.find((m) => scene!.nodes[m.node].name === "Hip_mesh")!;
    // The instance itself: not smooth-skinned, so nothing in the global skin-joint table belongs to it.
    expect(mesh.skinJointCount).toBe(0);
    expect(mesh.skinJointStart).toBe(0);
    expect(scene!.skinJoints).toEqual([]);
  });

  it("resolves a toggled mesh's bones to real node indices, and quantizes its per-vertex weights", () => {
    const model = imported();
    hipMeshNode(model).mesh!.smoothSkinning = true;
    const { scene, diagnostics } = translateScene3D(riggedProject(model));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const mesh = scene!.meshes.find((m) => scene!.nodes[m.node].name === "Hip_mesh")!;
    expect(mesh.skinJointCount).toBe(2); // Hip and Arm, per buildArm's splitWeight vertex
    const joints = scene!.skinJoints.slice(mesh.skinJointStart, mesh.skinJointStart + mesh.skinJointCount);
    expect(joints.map((nodeIndex) => scene!.nodes[nodeIndex].name)).toEqual(["Hip", "Arm"]);
    expect(scene!.skinInverseBindMatrices).toHaveLength(mesh.skinJointCount);
    expect(scene!.skinInverseBindMatrices[0]).toHaveLength(16);
    // Every other matrix this compiler writes (a node's own world, the camera's view, ...) is converted to the DS's
    // f32 (20.12) fixed point before it reaches the generated C -- plain integers, 1.0 stored as 4096. A skin's own
    // inverse bind matrices must go through that same conversion; writing the raw floats straight through (as this
    // once did) compiles fine, since C silently truncates a float literal assigned to an int32_t array, but produces
    // near-garbage matrices at runtime (a rotation entry like 0.9996 truncates to 0) -- invisible to a test that only
    // checks shape/length, like the two above, and really only visible on real, non-trivial skin data, not this
    // fixture's simple identity-ish matrices, which is exactly why a real file was needed to catch it in the first
    // place. Every component here must be a plain integer, and the identity rotation axis (1.0) must be 4096.
    for (const m of scene!.skinInverseBindMatrices) for (const component of m) expect(Number.isInteger(component)).toBe(true);
    expect(scene!.skinInverseBindMatrices[0][0]).toBe(4096); // Hip's own IBM is identity: the X axis is exactly 1.0
    const primitive = scene!.primitives[mesh.primitive];
    expect(primitive.skinJoints).toBeDefined();
    expect(primitive.skinWeights).toBeDefined();
    // Vertex 2's split (0.5/0.5) survives, quantized to a byte (255 = full weight).
    const vertexIndex = primitive.skinJoints!.findIndex((_, i) => i % 4 === 0 && primitive.skinWeights![i] > 0 && primitive.skinWeights![i] < 255);
    expect(vertexIndex).toBeGreaterThanOrEqual(0);
    expect(primitive.skinWeights![vertexIndex]).toBeCloseTo(127, -1);
    expect(primitive.skinWeights![vertexIndex + 1]).toBeCloseTo(127, -1);
  });

  it("still resolves a toggled mesh's bones when the whole rigged model lives in a scene instance, not placed in the scene directly", () => {
    // A real "Player" scene (the rigged model, as its own separate scene) instanced into "Main": expandSceneInstances
    // (project-scenes.ts) renames every node id inside the instanced subtree to `<instance id>/<its own id>`, so two
    // instances of one scene don't collide -- including, via its own special-cased renaming, an AnimationPlayer's
    // track.nodeId. A skin's jointNodeIds can't get that same treatment: they live outside the scene tree entirely,
    // on the shared ImportedMesh in `project.meshes`, so they still name bones by their original, un-instanced ids.
    // Before this was handled, every instanced copy of a smooth-skinned model silently fell back to rigid.
    const model = imported();
    hipMeshNode(model).mesh!.smoothSkinning = true;
    const base = primitivesProject();
    const project: ProjectSnapshot = { ...base, meshes: model.meshes, scenes: [{ id: "player", name: "Player", scene: model.root }] };
    const instanceWrapper = { ...model.root, id: "instance-1", instanceOf: "player", children: [] };
    const mainScene = { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), instanceWrapper] };
    const expanded = expandSceneInstances(project, mainScene);
    const { scene, diagnostics } = translateScene3D({ ...project, scene: expanded });
    expect(diagnostics.filter((d) => d.code === "smooth-skinning-missing-bone")).toEqual([]);
    const mesh = scene!.meshes.find((m) => scene!.nodes[m.node].name === "Hip_mesh")!;
    expect(mesh.skinJointCount).toBe(2);
    const joints = scene!.skinJoints.slice(mesh.skinJointStart, mesh.skinJointStart + mesh.skinJointCount);
    expect(joints.map((nodeIndex) => scene!.nodes[nodeIndex].name)).toEqual(["Hip", "Arm"]);
  });

  it("falls back to rigid, with a warning, when the skin data references a bone the scene doesn't have", () => {
    const model = imported();
    const mesh = hipMeshNode(model).mesh!;
    mesh.smoothSkinning = true;
    const hipMeshInCore = model.meshes.find((m) => m.id === mesh.importedMeshId)!;
    hipMeshInCore.skin!.jointNodeIds = [...hipMeshInCore.skin!.jointNodeIds, "no-such-node"];
    const { scene, diagnostics } = translateScene3D(riggedProject(model));
    expect(diagnostics.some((d) => d.code === "smooth-skinning-missing-bone" && d.severity === "warning")).toBe(true);
    const dsMesh = scene!.meshes.find((m) => scene!.nodes[m.node].name === "Hip_mesh")!;
    expect(dsMesh.skinJointCount).toBe(0);
  });
});
