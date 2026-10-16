import { describe, expect, it } from "vitest";

import { MAX_IMPORTED_COORDINATE } from "./imported-mesh";
import { flattenSceneTree, type SceneNode } from "./scene-node";
import { importGltf, quaternionToEulerXYZ, readGlb, type GltfInput } from "./gltf-import";

/** requirements/scene-designer/STORY.rigged-models.md: importing a rigged glTF. */

import { buildArm, toGlb, type BuiltGltf as Built } from "./gltf-test-fixture";

const input = (built: Built): GltfInput => ({ json: built.json, buffers: [built.bin] });
const byName = (root: SceneNode, name: string): SceneNode => flattenSceneTree(root).find((n) => n.name === name)!;

describe("importing a rigged model", () => {
  it("makes the bones a tree of nodes with the file's rest pose, under a root named for the model", () => {
    const r = importGltf(input(buildArm()), "Robot");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.model.root.name).toBe("Robot");
    expect(r.model.boneCount).toBe(2);
    const hip = byName(r.model.root, "Hip");
    const bone = byName(r.model.root, "Arm");
    expect(hip.children.map((n) => n.name)).toContain("Arm");
    expect(bone.transform3D!.position).toEqual({ x: 0, y: 1, z: 0 });
    expect(bone.kind).toBe("Node3D");
  });

  it("gives each triangle to one bone, drawn under that bone with its vertices in the bone's own space", () => {
    const r = importGltf(input(buildArm()), "Robot");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.model.meshes).toHaveLength(2);
    expect(r.model.triangleCount).toBe(4);
    const hipPart = byName(byName(r.model.root, "Hip"), "Hip_mesh");
    const armPart = byName(byName(r.model.root, "Arm"), "Arm_mesh");
    expect(hipPart.kind).toBe("MeshInstance3D");
    const hipMesh = r.model.meshes.find((m) => m.id === hipPart.mesh!.importedMeshId)!;
    const armMesh = r.model.meshes.find((m) => m.id === armPart.mesh!.importedMeshId)!;
    const ys = (m: { positions: number[] }) => m.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys(hipMesh))).toBe(0);
    expect(Math.max(...ys(hipMesh))).toBe(1);
    // the upper quad is at y 1..2 in the model, and the arm bone sits at y = 1, so in the bone's space it is 0..1
    expect(Math.min(...ys(armMesh))).toBe(0);
    expect(Math.max(...ys(armMesh))).toBe(1);
    expect(armMesh.indices).toHaveLength(6);
    expect(armMesh.normals).toHaveLength(armMesh.positions.length);
  });

  it("still records rigid-only skin data (one bone, weight 1) for a plain single-bone-per-vertex mesh", () => {
    const r = importGltf(input(buildArm()), "Robot");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const hipMesh = r.model.meshes.find((m) => m.name.includes("Hip_mesh"))!;
    const hip = byName(r.model.root, "Hip");
    expect(hipMesh.skin).toEqual({
      jointNodeIds: [hip.id],
      inverseBindMatrices: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      joints: new Array(4 * 4).fill(0),
      weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    });
  });

  it("captures a real multi-bone split (joints, weights, inverse-bind matrices) a later smooth-skinning toggle can use, without changing the rigid mesh data itself", () => {
    const r = importGltf(input(buildArm({ splitWeight: true })), "Robot");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const hipMesh = r.model.meshes.find((m) => m.name.includes("Hip_mesh"))!;
    const hip = byName(r.model.root, "Hip");
    const arm = byName(r.model.root, "Arm");
    const skin = hipMesh.skin!;
    expect(skin.jointNodeIds).toEqual([hip.id, arm.id]);
    expect(skin.inverseBindMatrices).toHaveLength(2 * 16);
    // Vertex 2 (the lower quad's top-right corner) is split 50/50 between Hip (local joint 0) and Arm (local joint 1).
    expect(skin.joints.slice(2 * 4, 2 * 4 + 4)).toEqual([0, 1, 0, 0]);
    expect(skin.weights.slice(2 * 4, 2 * 4 + 4)).toEqual([0.5, 0.5, 0, 0]);
    // The rigid mesh data itself (what the default, non-toggled render path uses) is untouched by any of this.
    expect(hipMesh.positions.slice(2 * 3, 2 * 3 + 3)).toEqual([0.5, 1, 0]);

    // At rest pose, the documented blending formula (Σ weight_i · jointWorld_i · inverseBindMatrices[i] · storedPosition)
    // must reconstruct vertex 2's real authored position exactly -- the whole point of an inverse bind matrix.
    const worldOf = (p: { x: number; y: number; z: number }): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, p.y, p.z, 1];
    const jointWorlds = [worldOf(hip.transform3D!.position), worldOf(arm.transform3D!.position)];
    const p = hipMesh.positions.slice(2 * 3, 2 * 3 + 3);
    const apply = (m: number[], v: number[]): number[] => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    const blended = [0, 0, 0];
    for (let i = 0; i < 2; i++) {
      const w = skin.weights[2 * 4 + i];
      const local = apply(skin.inverseBindMatrices.slice(i * 16, i * 16 + 16), p);
      const world = apply(jointWorlds[i], local);
      for (let k = 0; k < 3; k++) blended[k] += w * world[k];
    }
    expect(blended[0]).toBeCloseTo(0.5, 5);
    expect(blended[1]).toBeCloseTo(1, 5);
    expect(blended[2]).toBeCloseTo(0, 5);
  });

  it("keeps a split-weight vertex's skin data correctly rescaled when the whole file (not just mesh-local vertex data) needs the import-time shrink", () => {
    // A real downloaded file exposed this exact bug: the earlier "auto-scales a model too big" tests only inflate
    // the raw vertex positions, leaving the skin's own inverse bind matrices at their original (small) test-fixture
    // scale -- which never exercises this at all, since a small IBM needs no rescaling. A real oversized file's own
    // IBM data is in the SAME oversized units as everything else, so this inflates both together, matching that.
    const built = buildArm({ splitWeight: true });
    const positions = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(positions.buffer), 0);
    const ibmByteOffset = 280; // see buildArm: position(96) + joints(32) + weights(128) + indices(24) = 280
    const ibm = new Float32Array(built.bin.buffer, built.bin.byteOffset + ibmByteOffset, 32).map((v) => v * 100);
    built.bin.set(new Uint8Array(ibm.buffer), ibmByteOffset);

    const r = importGltf(input(built), "Big");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const hipMesh = r.model.meshes.find((m) => m.name.includes("Hip_mesh"))!;
    const hip = byName(r.model.root, "Hip");
    const arm = byName(r.model.root, "Arm");
    const skin = hipMesh.skin!;

    // Same reconstruction the plain (unscaled) split-weight test above checks: the blend formula must still land
    // vertex 2 at its real rest-pose position -- (0.5, 1, 0), exactly as before any of this file was ever inflated --
    // using the already-shrunk bone positions, mesh data and inverse bind matrices together. Before the fix, the
    // mismatched scales threw this wildly out of place (hundreds of units away, not a few decimal places off).
    const worldOf = (p: { x: number; y: number; z: number }): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, p.y, p.z, 1];
    const jointWorlds = [worldOf(hip.transform3D!.position), worldOf(arm.transform3D!.position)];
    const p = hipMesh.positions.slice(2 * 3, 2 * 3 + 3);
    const apply = (m: number[], v: number[]): number[] => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    const blended = [0, 0, 0];
    for (let i = 0; i < 2; i++) {
      const w = skin.weights[2 * 4 + i];
      const local = apply(skin.inverseBindMatrices.slice(i * 16, i * 16 + 16), p);
      const world = apply(jointWorlds[i], local);
      for (let k = 0; k < 3; k++) blended[k] += w * world[k];
    }
    // Within a percent or so: float32 precision lost round-tripping the x100 inflation and its exact undo, not the
    // wild (hundreds-of-units) displacement the actual bug caused.
    expect(blended[0]).toBeCloseTo(0.5, 2);
    expect(blended[1]).toBeCloseTo(1, 2);
    expect(blended[2]).toBeCloseTo(0, 2);
  });

  it("uses the material's base color", () => {
    const r = importGltf(input(buildArm()), "Robot");
    if (!r.ok) throw new Error("should import");
    expect(byName(r.model.root, "Hip_mesh").mesh!.color).toBe("#ff0000");
  });

  it("brings the file's clips in as an AnimationPlayer's animations, on the bones", () => {
    const r = importGltf(input(buildArm({ animation: true })), "Robot");
    if (!r.ok) throw new Error("should import");
    expect(r.model.clipNames).toEqual(["bend"]);
    const player = byName(r.model.root, "AnimationPlayer");
    expect(player.kind).toBe("AnimationPlayer");
    const [clip] = player.animation!.animations!;
    expect(clip).toMatchObject({ name: "bend", length: 1, loop: true });
    const track = clip.tracks[0];
    expect(track.nodeId).toBe(byName(r.model.root, "Arm").id);
    expect(track.property).toBe("rotation");
    const first = track.keys[0].value as { x: number; y: number; z: number };
    const last = track.keys[track.keys.length - 1].value as { x: number; y: number; z: number };
    expect(first.z).toBeCloseTo(0, 3);
    expect(last.z).toBeCloseTo(90, 2);
    // a straight bend is thinned to its two ends
    expect(track.keys).toHaveLength(2);
  });

  it("reads cubic spline clips too", () => {
    const r = importGltf(input(buildArm({ animation: true, cubic: true })), "Robot");
    if (!r.ok) throw new Error("should import");
    const track = byName(r.model.root, "AnimationPlayer").animation!.animations![0].tracks[0];
    expect((track.keys[track.keys.length - 1].value as { z: number }).z).toBeCloseTo(90, 2);
  });

  it("has no AnimationPlayer when the file has no clips", () => {
    const r = importGltf(input(buildArm()), "Robot");
    if (!r.ok) throw new Error("should import");
    expect(flattenSceneTree(r.model.root).some((n) => n.kind === "AnimationPlayer")).toBe(false);
  });

  it("puts a skinned mesh with no weights on the first bone and says so", () => {
    const r = importGltf(input(buildArm({ noSkinWeights: true })), "Robot");
    if (!r.ok) throw new Error("should import");
    expect(r.warnings.join(" ")).toMatch(/no bone weights/);
    expect(byName(byName(r.model.root, "Hip"), "Hip_mesh")).toBeDefined();
    expect(r.model.triangleCount).toBe(4);
  });

  it("reads a .glb file", () => {
    const glb = readGlb(toGlb(buildArm({ animation: true })));
    if (!glb.ok) throw new Error(glb.error);
    expect(importGltf(glb.input, "FromGlb").ok).toBe(true);
    expect(readGlb(new Uint8Array(30)).ok).toBe(false);
    expect(readGlb(new Uint8Array(4)).ok).toBe(false);
  });

  it("auto-scales a model too big for the DS's vertex numbers by actually shrinking it, instead of refusing it or just moving the oversize onto a compensating root scale", () => {
    const built = buildArm();
    const scaled = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(scaled.buffer), 0);
    const r = importGltf(input(built), "Big");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.warnings.join(" ")).toMatch(/scaled down/);
    for (const mesh of r.model.meshes) for (const c of mesh.positions) expect(Math.abs(c)).toBeLessThanOrEqual(MAX_IMPORTED_COORDINATE);
    // A compensating root scale would exactly cancel the mesh-data shrink back out, leaving the model at its
    // original, too-big-for-this-engine size (and so invisible at the viewport's usual camera distance) -- the
    // actual bug this test guards against. The root is left alone; the shrink is real.
    expect(r.model.root.transform3D!.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("shrinks bone rest positions along with the mesh data, so proportions stay right instead of a tiny mesh on a full-size skeleton", () => {
    const built = buildArm();
    const scaled = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(scaled.buffer), 0);
    const r = importGltf(input(built), "Big");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const arm = byName(r.model.root, "Arm");
    // Arm's own rest position (y = 1 in the unscaled file) is well inside the DS's vertex range on its own, so it
    // would never trigger the hardware check by itself -- it only has to shrink because the *mesh* did, to keep the
    // skeleton in proportion with the now-smaller geometry hanging off it.
    expect(arm.transform3D!.position.y).toBeLessThan(1);
  });

  it("shrinks a moving bone's own position keyframes to match, so an animation still ends up in the right (now smaller) place", () => {
    const built = buildArm({ positionAnimation: true });
    const scaled = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(scaled.buffer), 0);
    const r = importGltf(input(built), "Big");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const track = byName(r.model.root, "AnimationPlayer").animation!.animations![0].tracks[0];
    expect(track.property).toBe("position");
    const first = track.keys[0].value as { x: number; y: number; z: number };
    const last = track.keys[track.keys.length - 1].value as { x: number; y: number; z: number };
    // The file's clip slides Arm from y=1 to y=3 (a 2-unit move); after the same shrink the rest position got,
    // the move should still be exactly 2x the bone's own (now-shrunk) rest height, not the file's original scale.
    const arm = byName(r.model.root, "Arm");
    expect(first.y).toBeCloseTo(arm.transform3D!.position.y, 5);
    expect(last.y).toBeCloseTo(arm.transform3D!.position.y * 3, 5);
  });

  it("doesn't shrink the model's true rendered size past what its own real visual extent needs, even when a wrapping node already carries its own unrelated scale", () => {
    // A real Mixamo file exposed this: its bones sit under an "Armature" wrapper with its own small built-in scale
    // (a cm-to-m unit conversion), separate from any bone's own rest position. The hardware check reacts to *raw*,
    // pre-that-scale vertex-to-bone distances (a format limit on the stored number itself, unaffected by any node's
    // scale), so it can demand a far bigger shrink than the model's true, already-scaled visual size calls for.
    // Dividing every position by that bigger shrink (as this once did) still keeps proportions correct, but leaves
    // the model's real rendered size far smaller than this engine's own "about 2 units tall" convention intends --
    // small enough that the smooth-skinning blend's fixed-point rounding became visible as real distortion.
    const built = buildArm({ armatureScale: 0.01 });
    const positions = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(positions.buffer), 0);
    (built.json.nodes as Array<Record<string, unknown>>)[1].translation = [0, 100, 0];
    // The skin's own inverse bind matrix translations need the same x100 as everything else above (only the
    // translation, indices 12-14 of each 16-float matrix -- the rotation/scale linear part isn't a distance, same
    // invariant the actual fix relies on), so the mesh data and the skin data agree on what "one unit" means.
    const ibmByteOffset = 280; // see buildArm: position(96) + joints(32) + weights(128) + indices(24) = 280
    const ibm = new Float32Array(built.bin.buffer, built.bin.byteOffset + ibmByteOffset, 32); // a view, mutated in place
    for (const m of [0, 16]) {
      ibm[m + 12] *= 100;
      ibm[m + 13] *= 100;
      ibm[m + 14] *= 100;
    }

    const r = importGltf(input(built), "Robot");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.warnings.join(" ")).toMatch(/scaled down/);
    for (const mesh of r.model.meshes) for (const c of mesh.positions) expect(Math.abs(c)).toBeLessThanOrEqual(MAX_IMPORTED_COORDINATE);

    const armature = byName(r.model.root, "Armature");
    const arm = byName(r.model.root, "Arm");
    // Arm's real height, once Armature's own scale is folded in, same as if the file had never needed any
    // hardware-driven shrink at all (the file's own un-inflated Arm sits at y = 1, 100 pre-inflation, meant to end
    // up at y = 1 after Armature's original 0.01 scale). Before the fix this landed around 0.01 -- Armature's own
    // scale left untouched while bone positions were shrunk by the much bigger hardware-driven factor on top of it.
    const trueArmY = armature.transform3D!.scale.y * arm.transform3D!.position.y;
    expect(trueArmY).toBeCloseTo(1, 1);
  });

  it("reports a file with no nodes or missing data as errors, not exceptions", () => {
    expect(importGltf({ json: {}, buffers: [] }, "x").ok).toBe(false);
    expect(importGltf({ json: buildArm().json, buffers: [] }, "x").ok).toBe(false);
  });
});

describe("importing with unifiedSkinning (no per-bone split -- a model going smooth-skinned doesn't need one)", () => {
  it("makes one mesh node, not one per bone, parented to the mesh's own node rather than any bone", () => {
    const r = importGltf(input(buildArm({ splitWeight: true })), "Robot", { unifiedSkinning: true });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.model.meshes).toHaveLength(1); // not 2 (Hip_mesh + Arm_mesh), as the default (split) import gives
    const body = byName(r.model.root, "Body"); // buildArm's mesh node itself, unused in the default split import
    const part = byName(body, "Body_mesh");
    expect(part.kind).toBe("MeshInstance3D");
    expect(part.mesh?.smoothSkinning).toBe(true); // opted in directly, no separate Inspector toggle needed
    // Not nested under Hip or Arm at all -- the whole point of not splitting.
    const hip = byName(r.model.root, "Hip");
    const arm = byName(r.model.root, "Arm");
    expect(hip.children.some((n) => n.name === "Body_mesh")).toBe(false);
    expect(arm.children.some((n) => n.name === "Body_mesh")).toBe(false);
  });

  it("keeps every vertex's real (possibly multi-bone) weighting, not reduced to one dominant bone", () => {
    const r = importGltf(input(buildArm({ splitWeight: true })), "Robot", { unifiedSkinning: true });
    if (!r.ok) throw new Error(r.errors.join(" "));
    const mesh = r.model.meshes[0];
    const hip = byName(r.model.root, "Hip");
    const arm = byName(r.model.root, "Arm");
    expect(mesh.skin!.jointNodeIds).toEqual([hip.id, arm.id]);
    // Vertex 2 (the lower quad's top-right corner) is split 50/50 between Hip and Arm, same as the file authored it.
    expect(mesh.skin!.joints.slice(2 * 4, 2 * 4 + 4)).toEqual([0, 1, 0, 0]);
    expect(mesh.skin!.weights.slice(2 * 4, 2 * 4 + 4)).toEqual([0.5, 0.5, 0, 0]);
  });

  it("stores positions and inverse bind matrices in the file's own raw space (no rebasing), and the blend formula still reconstructs the real rest-pose position", () => {
    // The critical regression check for this path's whole premise: skipping the dominant-bone-split path's own
    // rebasing (position into a chosen bone's local space, inverse bind matrices re-expressed relative to it) is
    // only correct if glTF's raw vertex data and raw inverseBindMatrices are already consistent with each other on
    // their own -- this reconstructs a known vertex's real authored position by hand, the same way the split path's
    // own equivalent test above does, to prove that's actually true rather than assumed.
    const r = importGltf(input(buildArm({ splitWeight: true })), "Robot", { unifiedSkinning: true });
    if (!r.ok) throw new Error(r.errors.join(" "));
    const mesh = r.model.meshes[0];
    const hip = byName(r.model.root, "Hip");
    const arm = byName(r.model.root, "Arm");
    const skin = mesh.skin!;
    const worldOf = (p: { x: number; y: number; z: number }): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, p.y, p.z, 1];
    const jointWorlds = [worldOf(hip.transform3D!.position), worldOf(arm.transform3D!.position)];
    const p = mesh.positions.slice(2 * 3, 2 * 3 + 3);
    const apply = (m: number[], v: number[]): number[] => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    const blended = [0, 0, 0];
    for (let i = 0; i < 2; i++) {
      const w = skin.weights[2 * 4 + i];
      const local = apply(skin.inverseBindMatrices.slice(i * 16, i * 16 + 16), p);
      const world = apply(jointWorlds[i], local);
      for (let k = 0; k < 3; k++) blended[k] += w * world[k];
    }
    expect(blended[0]).toBeCloseTo(0.5, 5);
    expect(blended[1]).toBeCloseTo(1, 5);
    expect(blended[2]).toBeCloseTo(0, 5);
  });

  it("still gives a purely-rigid (no vertex actually split between bones) model just one mesh, each vertex kept single-bone", () => {
    // buildArm() without splitWeight has no vertex blending between bones -- the lower quad is 100% Hip, the upper
    // 100% Arm -- but the mesh as a whole still spans both bones (different vertices, different single bones), so
    // its joint list correctly has both, same as the default split import's own two pieces would together.
    const r = importGltf(input(buildArm()), "Robot", { unifiedSkinning: true });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.model.meshes).toHaveLength(1); // one mesh, not split into Hip_mesh + Arm_mesh
    const skin = r.model.meshes[0].skin!;
    expect(skin.jointNodeIds).toHaveLength(2); // the mesh overall still touches both bones
    // But no individual vertex blends between them: exactly one nonzero (full) weight per vertex.
    const vertexCount = skin.weights.length / 4;
    for (let v = 0; v < vertexCount; v++) {
      const nonzero = skin.weights.slice(v * 4, v * 4 + 4).filter((w) => w > 0);
      expect(nonzero).toEqual([1]);
    }
  });

  it("leaves the default (no options, or unifiedSkinning: false) import exactly as it was -- still split by dominant bone", () => {
    const withOptions = importGltf(input(buildArm({ splitWeight: true })), "Robot", { unifiedSkinning: false });
    const withoutOptions = importGltf(input(buildArm({ splitWeight: true })), "Robot");
    if (!withOptions.ok || !withoutOptions.ok) throw new Error("expected both imports to succeed");
    expect(withOptions.model.meshes).toHaveLength(2);
    expect(withoutOptions.model.meshes).toHaveLength(2);
  });
});

describe("quaternion to the editor's Euler angles", () => {
  it("turns quarter turns about each axis into 90 degrees on that axis", () => {
    const s = Math.SQRT1_2;
    const near = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
      expect(v.x).toBeCloseTo(x, 3);
      expect(v.y).toBeCloseTo(y, 3);
      expect(v.z).toBeCloseTo(z, 3);
    };
    near(quaternionToEulerXYZ([s, 0, 0, s]), 90, 0, 0);
    near(quaternionToEulerXYZ([0, s, 0, s]), 0, 90, 0);
    near(quaternionToEulerXYZ([0, 0, s, s]), 0, 0, 90);
    near(quaternionToEulerXYZ([0, 0, 0, 1]), 0, 0, 0);
  });
});
