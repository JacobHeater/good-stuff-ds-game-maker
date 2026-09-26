import { describe, expect, it } from "vitest";

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

  it("refuses a model too big for the DS's vertex numbers, saying to scale it", () => {
    const built = buildArm();
    const scaled = new Float32Array(built.bin.buffer, built.bin.byteOffset, 24).map((v) => v * 100);
    built.bin.set(new Uint8Array(scaled.buffer), 0);
    const r = importGltf(input(built), "Big");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/Scale the model down/);
  });

  it("reports a file with no nodes or missing data as errors, not exceptions", () => {
    expect(importGltf({ json: {}, buffers: [] }, "x").ok).toBe(false);
    expect(importGltf({ json: buildArm().json, buffers: [] }, "x").ok).toBe(false);
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
