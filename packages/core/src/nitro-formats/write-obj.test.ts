import { describe, expect, it } from "vitest";

import type { DecodedNsbmd } from "./decode-nsbmd";
import { writeObj } from "./write-obj";

const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("writeObj", () => {
  it("writes a single-bone triangle at the origin", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [{ boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }],
      materialNames: ["Mat"]
    };
    const obj = writeObj(model, "Test");
    const lines = obj.split("\n");
    expect(lines).toContain("v 0.000000 0.000000 0.000000");
    expect(lines).toContain("v 1.000000 0.000000 0.000000");
    expect(lines).toContain("v 0.000000 1.000000 0.000000");
    expect(lines).toContain("f 1 2 3");
  });

  it("transforms a mesh by its (possibly nested) bone's world position", () => {
    const model: DecodedNsbmd = {
      bones: [
        { name: "Hip", parentIndex: -1, position: { x: 10, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } },
        { name: "Leg", parentIndex: 0, position: { x: 0, y: -5, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }
      ],
      meshes: [{ boneIndex: 1, materialIndex: 0, positions: [0, 0, 0], indices: [] }],
      materialNames: ["Mat"]
    };
    const obj = writeObj(model, "Test");
    // Leg's world position is Hip's (10,0,0) + Leg's own (0,-5,0) = (10,-5,0); the mesh's one vertex is at that bone's origin.
    expect(obj).toContain("v 10.000000 -5.000000 0.000000");
  });

  it("offsets face indices correctly across multiple meshes, and keeps meshes' vertices separate", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [
        { boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
        { boneIndex: 0, materialIndex: 0, positions: [2, 0, 0, 3, 0, 0, 2, 1, 0], indices: [0, 1, 2] }
      ],
      materialNames: ["Mat"]
    };
    const obj = writeObj(model, "Test");
    const lines = obj.split("\n");
    expect(lines).toContain("f 1 2 3");
    expect(lines).toContain("f 4 5 6"); // the second mesh's triangle, offset by the first mesh's 3 vertices
  });

  it("writes UV coordinates, flipping V to OBJ's bottom-to-top convention", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [{ boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
      materialNames: ["Mat"]
    };
    const obj = writeObj(model, "Test");
    const lines = obj.split("\n");
    expect(lines).toContain("vt 0.000000 1.000000"); // v=0 -> 1-0=1
    expect(lines).toContain("vt 0.000000 0.000000"); // v=1 -> 1-1=0
    expect(lines).toContain("f 1/1 2/2 3/3");
  });
});
