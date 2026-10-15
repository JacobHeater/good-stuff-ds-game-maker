import { describe, expect, it } from "vitest";

import type { DecodedNsbca } from "./decode-nsbca";
import type { DecodedNsbmd } from "./decode-nsbmd";
import { writeGlb } from "./write-glb";

const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Parses a .glb's own two chunks back out, just enough to check `writeGlb`'s own output -- not a general-purpose glTF reader. */
function parseGlb(bytes: Uint8Array): { json: Record<string, unknown>; binary: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  const totalLength = view.getUint32(8, true);
  expect(totalLength).toBe(bytes.length);

  let offset = 12;
  const jsonLength = view.getUint32(offset, true);
  offset += 8; // length + type
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(offset, offset + jsonLength)));
  offset += jsonLength;

  const binLength = view.getUint32(offset, true);
  offset += 8;
  const binary = bytes.slice(offset, offset + binLength);
  return { json, binary };
}

function readAccessor(json: Record<string, unknown>, binary: Uint8Array, accessorIndex: number): Float32Array | Uint16Array | Uint32Array {
  const accessors = json.accessors as Record<string, unknown>[];
  const bufferViews = json.bufferViews as Record<string, unknown>[];
  const accessor = accessors[accessorIndex];
  const bufferView = bufferViews[accessor.bufferView as number];
  const byteOffset = bufferView.byteOffset as number;
  const componentCount = accessor.type === "SCALAR" ? 1 : accessor.type === "VEC2" ? 2 : accessor.type === "VEC3" ? 3 : 4;
  const count = (accessor.count as number) * componentCount;
  const view = new DataView(binary.buffer, binary.byteOffset + byteOffset, binary.byteLength - byteOffset);
  if (accessor.componentType === 5126) return new Float32Array(Array.from({ length: count }, (_, i) => view.getFloat32(i * 4, true)));
  if (accessor.componentType === 5123) return new Uint16Array(Array.from({ length: count }, (_, i) => view.getUint16(i * 2, true)));
  return new Uint32Array(Array.from({ length: count }, (_, i) => view.getUint32(i * 4, true)));
}

describe("writeGlb", () => {
  it("writes a valid glb container with one bone node and one mesh node as its child", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 1, y: 2, z: 3 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [{ boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
      materialNames: ["Mat"]
    };
    const { json, binary } = parseGlb(writeGlb(model, "Test"));

    expect(json.scenes).toEqual([{ nodes: [0] }]);
    const nodes = json.nodes as Record<string, unknown>[];
    expect(nodes).toHaveLength(2); // bone node, mesh node
    expect(nodes[0].translation).toEqual([1, 2, 3]);
    expect(nodes[0].children).toEqual([1]);
    expect(nodes[1].mesh).toBe(0);

    const meshes = json.meshes as Record<string, unknown>[];
    const primitive = (meshes[0].primitives as Record<string, unknown>[])[0];
    const positions = readAccessor(json, binary, (primitive.attributes as Record<string, number>).POSITION);
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = readAccessor(json, binary, primitive.indices as number);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
  });

  it("nests a child bone under its parent and leaves the parent as the sole scene root", () => {
    const model: DecodedNsbmd = {
      bones: [
        { name: "Hip", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } },
        { name: "Leg", parentIndex: 0, position: { x: 0, y: -5, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }
      ],
      meshes: [],
      materialNames: []
    };
    const { json } = parseGlb(writeGlb(model, "Test"));
    expect(json.scenes).toEqual([{ nodes: [0] }]);
    const nodes = json.nodes as Record<string, unknown>[];
    expect(nodes[0].children).toEqual([1]);
  });

  it("uses a 32-bit index buffer only when a mesh actually needs one", () => {
    const smallMesh: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [{ boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }],
      materialNames: []
    };
    const { json: smallJson } = parseGlb(writeGlb(smallMesh, "Test"));
    const smallPrimitive = ((smallJson.meshes as Record<string, unknown>[])[0].primitives as Record<string, unknown>[])[0];
    const smallIdxAccessor = (smallJson.accessors as Record<string, unknown>[])[smallPrimitive.indices as number];
    expect(smallIdxAccessor.componentType).toBe(5123);

    const bigIndices = [0, 1, 70000]; // a vertex index above 65535 forces a wider index buffer
    const bigMesh: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [{ boneIndex: 0, materialIndex: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: bigIndices }],
      materialNames: []
    };
    const { json: bigJson } = parseGlb(writeGlb(bigMesh, "Test"));
    const bigPrimitive = ((bigJson.meshes as Record<string, unknown>[])[0].primitives as Record<string, unknown>[])[0];
    const bigIdxAccessor = (bigJson.accessors as Record<string, unknown>[])[bigPrimitive.indices as number];
    expect(bigIdxAccessor.componentType).toBe(5125);
  });

  it("writes an animation with translation and rotation channels sampled per frame", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [],
      materialNames: []
    };
    const animation: DecodedNsbca = {
      numFrames: 2,
      tracks: [
        {
          boneIndex: 0,
          translation: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
          rotation: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 90, z: 0 }]
        }
      ]
    };
    const { json, binary } = parseGlb(writeGlb(model, "Test", animation, 30));
    const animations = json.animations as Record<string, unknown>[];
    expect(animations).toHaveLength(1);
    const channels = animations[0].channels as Record<string, unknown>[];
    expect(channels).toHaveLength(2); // translation + rotation, no scale track was given

    const samplers = animations[0].samplers as Record<string, unknown>[];
    const translationChannel = channels.find((c) => (c.target as Record<string, unknown>).path === "translation")!;
    const translationSampler = samplers[translationChannel.sampler as number];
    const translationValues = readAccessor(json, binary, translationSampler.output as number);
    expect(Array.from(translationValues)).toEqual([0, 0, 0, 5, 0, 0]);

    const timeValues = readAccessor(json, binary, translationSampler.input as number);
    expect(Array.from(timeValues).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, Math.round((1 / 30) * 1000) / 1000]);

    const rotationChannel = channels.find((c) => (c.target as Record<string, unknown>).path === "rotation")!;
    const rotationSampler = samplers[rotationChannel.sampler as number];
    const rotationValues = readAccessor(json, binary, rotationSampler.output as number);
    // Frame 0: identity quaternion. Frame 1: 90 degrees around Y -> [0, sin(45deg), 0, cos(45deg)].
    expect(Array.from(rotationValues.slice(0, 4)).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0, 1]);
    const expectedY = Math.round(Math.sin(Math.PI / 4) * 1000) / 1000;
    const expectedW = Math.round(Math.cos(Math.PI / 4) * 1000) / 1000;
    expect(Array.from(rotationValues.slice(4, 8)).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, expectedY, 0, expectedW]);
  });

  it("omits the animations array entirely when no animation is given", () => {
    const model: DecodedNsbmd = {
      bones: [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_3X3, scale: { x: 1, y: 1, z: 1 } }],
      meshes: [],
      materialNames: []
    };
    const { json } = parseGlb(writeGlb(model, "Test"));
    expect(json.animations).toBeUndefined();
  });
});
