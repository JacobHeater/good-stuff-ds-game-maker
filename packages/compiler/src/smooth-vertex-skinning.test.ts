import { buildArm, expandSceneInstances, flattenSceneTree, importGltf, type PrimitiveGeometry, type ProjectSnapshot, type RiggedModel } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { primitivesProject } from "./fixtures";
import { limitBlendGroups, limitToTwoStrongestInfluences, quantizeWeightLevels, reorderSkinnedTrianglesByBlendSignature, translateScene3D } from "./translate-scene-3d";

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

describe("reorderSkinnedTrianglesByBlendSignature (performance: STORY.smooth-vertex-skinning.md note 8)", () => {
  /** Builds a triangle whose 3 vertices all share one blend signature, so the triangle itself is "pure" (the usual
   * case away from a joint seam) -- `x` tags which source triangle this is, so a test can tell where it landed after
   * reordering. */
  function pureTriangle(x: number, joint: number): { positions: number[]; normals: number[]; skinJoints: number[]; skinWeights: number[] } {
    return {
      positions: [x, 0, 0, x, 1, 0, x, 0, 1],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      skinJoints: [joint, 0, 0, 0, joint, 0, 0, 0, joint, 0, 0, 0],
      skinWeights: [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]
    };
  }

  function concatTriangles(triangles: ReturnType<typeof pureTriangle>[]): PrimitiveGeometry {
    return {
      triangleCount: triangles.length,
      positions: triangles.flatMap((t) => t.positions),
      normals: triangles.flatMap((t) => t.normals),
      skinJoints: triangles.flatMap((t) => t.skinJoints),
      skinWeights: triangles.flatMap((t) => t.skinWeights)
    };
  }

  /** Which source triangle (by its `x` tag) each output triangle came from, in output order. */
  function triangleOrigins(geometry: PrimitiveGeometry): number[] {
    const origins: number[] = [];
    for (let t = 0; t < geometry.triangleCount; t++) origins.push(geometry.positions[t * 9]); // vertex 0's x
    return origins;
  }

  it("groups triangles that share a bone together, even when the source interleaves them with a different bone's", () => {
    // Joint 0, joint 1, joint 0, joint 1 in the source -- 3 signature changes between consecutive triangles.
    const geometry = concatTriangles([pureTriangle(0, 0), pureTriangle(10, 1), pureTriangle(20, 0), pureTriangle(30, 1)]);
    const reordered = reorderSkinnedTrianglesByBlendSignature(geometry);
    expect(reordered.triangleCount).toBe(4);
    const origins = triangleOrigins(reordered);
    expect([...origins].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]); // every source triangle survives, none duplicated or dropped (sorts a copy: .sort() mutates in place)
    // Only one joint-boundary crossing now (the two joint-0 triangles grouped, the two joint-1 triangles grouped),
    // down from three in the source order -- this is the whole point: draw_skinned_mesh's own runtime dedup only
    // helps when matching vertices are actually adjacent in the compiled stream.
    const jointOf = (origin: number) => (origin === 0 || origin === 20 ? 0 : 1);
    let transitions = 0;
    for (let i = 1; i < 4; i++) if (jointOf(origins[i]) !== jointOf(origins[i - 1])) transitions++;
    expect(transitions).toBe(1);
  });

  it("keeps each triangle's own 3 vertices together, in their original relative order (winding untouched)", () => {
    const geometry = concatTriangles([pureTriangle(0, 1), pureTriangle(10, 0)]);
    const reordered = reorderSkinnedTrianglesByBlendSignature(geometry);
    for (let t = 0; t < reordered.triangleCount; t++) {
      const x = reordered.positions[t * 9];
      // The 3 vertices' own y/z pattern (0,0 / 1,0 / 0,1) is pureTriangle's fixed shape: if winding had been
      // scrambled this wouldn't match for at least one of the two triangles.
      expect(reordered.positions.slice(t * 9, t * 9 + 9)).toEqual([x, 0, 0, x, 1, 0, x, 0, 1]);
      expect(reordered.skinJoints!.slice(t * 12, t * 12 + 12)).toEqual(x === 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it("leaves a mesh with no skin data untouched -- the very same object, not even a copy", () => {
    const geometry: PrimitiveGeometry = { triangleCount: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] };
    expect(reorderSkinnedTrianglesByBlendSignature(geometry)).toBe(geometry);
  });

  it("carries UVs along in lockstep when the mesh has them", () => {
    const geometry: PrimitiveGeometry = {
      ...concatTriangles([pureTriangle(0, 1), pureTriangle(10, 0)]),
      uvs: [0, 0, 0, 1, 1, 0, /* triangle 1 */ 1, 1, 1, 0, 0, 1]
    };
    const reordered = reorderSkinnedTrianglesByBlendSignature(geometry);
    // Joint-0 triangle (source index 1, x=10) sorts before joint-1 (source index 0, x=0): its own UVs (the second
    // trio in the source) must be the ones that moved to the front, not the first trio's.
    expect(reordered.uvs!.slice(0, 6)).toEqual([1, 1, 1, 0, 0, 1]);
  });
});

describe("limitToTwoStrongestInfluences (performance: STORY.smooth-vertex-skinning.md note 10)", () => {
  function oneVertexGeometry(joints: number[], weights: number[]): PrimitiveGeometry {
    return { triangleCount: 0, positions: [], normals: [], skinJoints: joints, skinWeights: weights };
  }

  it("drops the 2 weakest of 4 influences and renormalizes the 2 kept so they still sum to 1", () => {
    // Joint 2 (0.1) and joint 3 (0.05) are the weakest; joint 0 (0.6) and joint 1 (0.25) survive, renormalized
    // 0.6/0.85 and 0.25/0.85.
    const geometry = oneVertexGeometry([0, 1, 2, 3], [0.6, 0.25, 0.1, 0.05]);
    const limited = limitToTwoStrongestInfluences(geometry);
    expect(limited.skinJoints).toEqual([0, 1, 0, 0]);
    expect(limited.skinWeights![0]).toBeCloseTo(0.6 / 0.85, 10);
    expect(limited.skinWeights![1]).toBeCloseTo(0.25 / 0.85, 10);
    expect(limited.skinWeights![2]).toBe(0);
    expect(limited.skinWeights![3]).toBe(0);
  });

  it("leaves an already-2-bone (or fewer) vertex's weights numerically unchanged", () => {
    const geometry = oneVertexGeometry([4, 5, 0, 0], [0.5, 0.5, 0, 0]);
    const limited = limitToTwoStrongestInfluences(geometry);
    expect(limited.skinJoints).toEqual([4, 5, 0, 0]);
    expect(limited.skinWeights).toEqual([0.5, 0.5, 0, 0]);
  });

  it("finds the top 2 regardless of which of the 4 slots they start in", () => {
    // The two strongest (0.4 at slot 3, 0.35 at slot 0) are not adjacent and not in slots 0-1.
    const geometry = oneVertexGeometry([10, 11, 12, 13], [0.35, 0.1, 0.15, 0.4]);
    const limited = limitToTwoStrongestInfluences(geometry);
    expect(limited.skinJoints).toEqual([10, 0, 0, 13]);
    expect(limited.skinWeights![0]).toBeCloseTo(0.35 / 0.75, 10);
    expect(limited.skinWeights![3]).toBeCloseTo(0.4 / 0.75, 10);
  });

  it("leaves a mesh with no skin data untouched -- the very same object, not even a copy", () => {
    const geometry: PrimitiveGeometry = { triangleCount: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] };
    expect(limitToTwoStrongestInfluences(geometry)).toBe(geometry);
  });
});

describe("quantizeWeightLevels (performance: STORY.smooth-vertex-skinning.md note 11)", () => {
  function oneVertexGeometry(joints: number[], weights: number[]): PrimitiveGeometry {
    return { triangleCount: 0, positions: [], normals: [], skinJoints: joints, skinWeights: weights };
  }

  it("snaps two merely-close (not identical) continuous splits onto the exact same quantized signature", () => {
    // The whole point: a real, continuously-painted rig rarely repeats a weight split exactly, but 0.601/0.399 and
    // 0.599/0.401 are visually indistinguishable -- after this, they must come out byte-identical, or
    // reorderSkinnedTrianglesByBlendSignature's own clustering can't tell they belong together.
    const a = quantizeWeightLevels(oneVertexGeometry([0, 1, 0, 0], [0.601, 0.399, 0, 0]));
    const b = quantizeWeightLevels(oneVertexGeometry([0, 1, 0, 0], [0.599, 0.401, 0, 0]));
    expect(a.skinWeights).toEqual(b.skinWeights);
  });

  it("still sums to 1 (so the runtime blend covers full weight, not a gap) after rounding to discrete levels", () => {
    const limited = quantizeWeightLevels(oneVertexGeometry([0, 1, 0, 0], [0.73, 0.27, 0, 0]));
    expect(limited.skinWeights![0] + limited.skinWeights![1]).toBeCloseTo(1, 10);
  });

  it("leaves a single full-weight (rigid) vertex at exactly full weight, no quantization artifact", () => {
    const limited = quantizeWeightLevels(oneVertexGeometry([0, 0, 0, 0], [1, 0, 0, 0]));
    expect(limited.skinWeights![0]).toBe(1);
  });

  it("never rounds a real but weak influence away to nothing", () => {
    // 0.01 alone would round to level 0 (0.01 * 15 = 0.15); the function's own floor at 1 keeps a vertex that is
    // genuinely still split between two bones from silently collapsing to single-bone.
    const limited = quantizeWeightLevels(oneVertexGeometry([0, 1, 0, 0], [0.99, 0.01, 0, 0]));
    expect(limited.skinWeights![1]).toBeGreaterThan(0);
    expect(limited.skinWeights![0] + limited.skinWeights![1]).toBeCloseTo(1, 10);
  });

  it("leaves a mesh with no skin data untouched -- the very same object, not even a copy", () => {
    const geometry: PrimitiveGeometry = { triangleCount: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] };
    expect(quantizeWeightLevels(geometry)).toBe(geometry);
  });
});

describe("limitBlendGroups (performance: STORY.smooth-vertex-skinning.md note 12)", () => {
  function vertex(joints: number[], weights: number[]): { joints: number[]; weights: number[] } {
    return { joints, weights };
  }
  function geometryOf(vertices: ReturnType<typeof vertex>[]): PrimitiveGeometry {
    return { triangleCount: 0, positions: [], normals: [], skinJoints: vertices.flatMap((v) => v.joints), skinWeights: vertices.flatMap((v) => v.weights) };
  }

  it("leaves everything alone -- the very same object -- when the mesh already uses fewer pairs than the budget", () => {
    const geometry = geometryOf([vertex([1, 2, 0, 0], [0.6, 0.4, 0, 0]), vertex([3, 4, 0, 0], [0.5, 0.5, 0, 0])]);
    expect(limitBlendGroups(geometry, 12)).toBe(geometry);
  });

  it("keeps the pairs used by the most vertices, collapsing a rarer one to single-bone rigid", () => {
    const common1 = vertex([1, 2, 0, 0], [0.6, 0.4, 0, 0]);
    const common2 = vertex([3, 4, 0, 0], [0.7, 0.3, 0, 0]);
    const rare = vertex([5, 6, 0, 0], [0.55, 0.45, 0, 0]);
    // Pair (1,2) used by 3 vertices, (3,4) by 2, (5,6) by 1 -- a budget of 2 keeps the first two, drops the third.
    const geometry = geometryOf([common1, common1, common1, common2, common2, rare]);
    const limited = limitBlendGroups(geometry, 2);
    expect(limited.skinJoints!.slice(0, 8)).toEqual([1, 2, 0, 0, 1, 2, 0, 0]); // the common pairs: untouched
    expect(limited.skinWeights!.slice(0, 8)).toEqual([0.6, 0.4, 0, 0, 0.6, 0.4, 0, 0]);
    const last = 5 * 4;
    expect(limited.skinJoints!.slice(last, last + 4)).toEqual([5, 0, 0, 0]); // the rare pair: collapsed to its own strongest joint
    expect(limited.skinWeights!.slice(last, last + 4)).toEqual([1, 0, 0, 0]);
  });

  it("never touches an already single-bone vertex, regardless of budget", () => {
    const rigid = vertex([9, 0, 0, 0], [1, 0, 0, 0]);
    const geometry = geometryOf([vertex([1, 2, 0, 0], [0.6, 0.4, 0, 0]), vertex([3, 4, 0, 0], [0.6, 0.4, 0, 0]), vertex([5, 6, 0, 0], [0.6, 0.4, 0, 0]), rigid]);
    const limited = limitBlendGroups(geometry, 1);
    const i = 3 * 4;
    expect(limited.skinJoints!.slice(i, i + 4)).toEqual(rigid.joints);
    expect(limited.skinWeights!.slice(i, i + 4)).toEqual(rigid.weights);
  });

  it("finds the strongest influence to keep regardless of which slots it's in", () => {
    const common = vertex([1, 2, 0, 0], [0.6, 0.4, 0, 0]);
    const rare = vertex([10, 0, 0, 11], [0.3, 0, 0, 0.7]); // strongest (joint 11, 0.7) sits in slot 3, not slot 0
    const geometry = geometryOf([common, common, common, rare]);
    const limited = limitBlendGroups(geometry, 1);
    const i = 3 * 4;
    expect(limited.skinJoints!.slice(i, i + 4)).toEqual([0, 0, 0, 11]);
    expect(limited.skinWeights!.slice(i, i + 4)).toEqual([0, 0, 0, 1]);
  });

  it("leaves a mesh with no skin data untouched -- the very same object, not even a copy", () => {
    const geometry: PrimitiveGeometry = { triangleCount: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] };
    expect(limitBlendGroups(geometry)).toBe(geometry);
  });
});
