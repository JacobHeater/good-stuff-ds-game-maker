import { describe, expect, it } from "vitest";

import { decodeNsbmd } from "./decode-nsbmd";
import { encodeNsbmd, type NsbmdBone, type NsbmdMaterial, type NsbmdMesh } from "./nsbmd";

function cube(): { positions: number[]; indices: number[] } {
  return {
    positions: [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
    indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]
  };
}

describe("decodeNsbmd", () => {
  it("round-trips a single-bone, untextured model exactly (vertex positions, triangles, bone count)", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const meshes: NsbmdMesh[] = [{ boneIndex: 0, materialIndex: 0, ...cube() }];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const decoded = decodeNsbmd(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.warnings).toEqual([]);
    expect(decoded.model.bones).toHaveLength(1);
    expect(decoded.model.bones[0].name).toBe("Root");
    expect(decoded.model.bones[0].parentIndex).toBe(-1);
    expect(decoded.model.materialNames).toEqual(["Mat"]);
    expect(decoded.model.meshes).toHaveLength(1);
    const mesh = decoded.model.meshes[0];
    expect(mesh.boneIndex).toBe(0);
    expect(mesh.materialIndex).toBe(0);
    expect(mesh.indices).toHaveLength(12); // 4 triangles
    // Positions round-trip exactly (within 1.3.12 fixed-point rounding): 8 unique vertices, 3 per triangle corner duplicated by the GX stream.
    expect(mesh.positions).toHaveLength(mesh.indices.length * 3);
    for (const v of mesh.positions) expect(Math.abs(v) - 1).toBeLessThan(0.001);
  });

  it("reconstructs a two-bone parent/child hierarchy from the render command list's own stack structure", () => {
    const bones: NsbmdBone[] = [
      { name: "Hip", parentIndex: -1, position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { name: "Leg", parentIndex: 0, position: { x: 0, y: -1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    ];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const meshes: NsbmdMesh[] = [
      { boneIndex: 0, materialIndex: 0, ...cube() },
      { boneIndex: 1, materialIndex: 0, ...cube() }
    ];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const decoded = decodeNsbmd(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.model.bones[0].name).toBe("Hip");
    expect(decoded.model.bones[0].parentIndex).toBe(-1);
    expect(decoded.model.bones[1].name).toBe("Leg");
    expect(decoded.model.bones[1].parentIndex).toBe(0); // reconstructed from the stack load, not from parent_idx
    expect(decoded.model.meshes[0].boneIndex).toBe(0);
    expect(decoded.model.meshes[1].boneIndex).toBe(1);
  });

  it("round-trips a bone's bind-pose translation, rotation and scale through the raw-matrix BoneMatrix form", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 2.5, y: -1.25, z: 0.5 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 1.5, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const meshes: NsbmdMesh[] = [{ boneIndex: 0, materialIndex: 0, ...cube() }];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const decoded = decodeNsbmd(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const bone = decoded.model.bones[0];
    expect(bone.position.x).toBeCloseTo(2.5, 2);
    expect(bone.position.y).toBeCloseTo(-1.25, 2);
    expect(bone.position.z).toBeCloseTo(0.5, 2);
    expect(bone.scale.x).toBeCloseTo(1.5, 2);
    expect(bone.scale.y).toBeCloseTo(1, 2);
    // Rotation: a 45-degree Y rotation should send the X axis partway toward -Z (row-major column 0 of the matrix).
    const rotatedX = [bone.rotation[0], bone.rotation[1], bone.rotation[2]]; // column-major: entries 0,1,2 = column 0 = where the X axis maps to
    expect(rotatedX[0]).toBeCloseTo(Math.cos((45 * Math.PI) / 180), 1);
  });

  it("round-trips a textured mesh's UVs", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat", textureName: "Wall", textureWidth: 32, textureHeight: 32 }];
    const quad = { positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0], indices: [0, 1, 2] };
    const meshes: NsbmdMesh[] = [{ boneIndex: 0, materialIndex: 0, uvs: [0, 0, 1, 0, 1, 1], ...quad }];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const decoded = decodeNsbmd(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.model.meshes[0].uvs).toBeDefined();
    expect(decoded.model.meshes[0].uvs).toHaveLength(6);
    expect(decoded.model.meshes[0].uvs![2]).toBeCloseTo(1, 1);
  });

  it("refuses a file that isn't an NSBMD", () => {
    const result = decodeNsbmd(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
  });
});
