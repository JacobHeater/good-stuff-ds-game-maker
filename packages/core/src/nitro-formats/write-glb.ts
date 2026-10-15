import { DS_HARDWARE_PROFILE } from "../hardware";
import type { DecodedNsbca } from "./decode-nsbca";
import type { DecodedNsbmd } from "./decode-nsbmd";
import { mat3ToQuaternion } from "./mat4";

const GLTF_FLOAT = 5126;
const GLTF_UNSIGNED_SHORT = 5123;
const GLTF_UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Accumulates one flat binary buffer (the GLB's single BIN chunk), 4-byte-aligning every pushed array as it goes. */
class BinaryBuffer {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  private push(bytes: Uint8Array): { byteOffset: number; byteLength: number } {
    const byteOffset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad > 0) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    return { byteOffset, byteLength: bytes.length };
  }

  pushFloats(values: readonly number[]): { byteOffset: number; byteLength: number } {
    const arr = new Float32Array(values);
    return this.push(new Uint8Array(arr.buffer));
  }

  pushIndices(values: readonly number[]): { byteOffset: number; byteLength: number; componentType: number } {
    const needsWide = values.some((v) => v > 0xffff);
    const arr = needsWide ? new Uint32Array(values) : new Uint16Array(values);
    const { byteOffset, byteLength } = this.push(new Uint8Array(arr.buffer));
    return { byteOffset, byteLength, componentType: needsWide ? GLTF_UNSIGNED_INT : GLTF_UNSIGNED_SHORT };
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** A single-axis Euler rotation (`DecodedNsbcaTrack`'s own shape -- only one of x/y/z is ever nonzero, see decode-nsbca.ts) straight to a quaternion, via the standard axis-angle formula -- simpler and more precise than building a 3x3 matrix first. */
function singleAxisEulerToQuaternion(euler: { x: number; y: number; z: number }): [number, number, number, number] {
  const axis: "x" | "y" | "z" = euler.x !== 0 ? "x" : euler.y !== 0 ? "y" : "z";
  const half = (euler[axis] * Math.PI) / 360;
  const s = Math.sin(half);
  const c = Math.cos(half);
  if (axis === "x") return [s, 0, 0, c];
  if (axis === "y") return [0, s, 0, c];
  return [0, 0, s, c];
}

function toJsonChunk(json: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (bytes.length % 4)) % 4;
  const padded = new Uint8Array(bytes.length + pad);
  padded.set(bytes);
  padded.fill(0x20, bytes.length); // the glTF spec requires JSON-chunk padding to be ASCII spaces
  return padded;
}

function toBinChunk(bytes: Uint8Array): Uint8Array {
  const pad = (4 - (bytes.length % 4)) % 4;
  if (pad === 0) return bytes;
  const padded = new Uint8Array(bytes.length + pad); // the glTF spec requires BIN-chunk padding to be zero bytes
  padded.set(bytes);
  return padded;
}

function writeChunk(chunkType: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  new DataView(out.buffer).setUint32(0, data.length, true);
  for (let i = 0; i < 4; i++) out[4 + i] = chunkType.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/**
 * Decoded NSBMD bones/meshes (and, optionally, a decoded NSBCA animation) to a self-contained glTF binary (.glb).
 * Bones become plain empty transform nodes and meshes become child nodes with identity-relative geometry -- NOT
 * glTF's skinning/joints/weights system -- since the DS GPU has no hardware vertex skinning and every mesh here is
 * already rigidly bound to exactly one bone (see decode-nsbmd.ts's own doc comment); this mirrors how this
 * project's own `gltf-import.ts` already represents a rigged model. `write-obj.ts` gives up this skeleton and
 * flattens to world space instead, since OBJ has no concept of bones at all -- GLB is the format that keeps it.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function writeGlb(model: DecodedNsbmd, name: string, animation?: DecodedNsbca, fps: number = DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget): Uint8Array {
  const buffer = new BinaryBuffer();
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshesJson: Record<string, unknown>[] = [];
  const nodes: { name: string; translation: number[]; rotation: number[]; scale: number[]; mesh?: number; children: number[] }[] = [];

  const addBufferView = (data: { byteOffset: number; byteLength: number }, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: data.byteOffset, byteLength: data.byteLength, ...(target !== undefined ? { target } : {}) });
    return bufferViews.length - 1;
  };

  model.bones.forEach((bone) => {
    const [x, y, z, w] = mat3ToQuaternion(bone.rotation);
    nodes.push({
      name: bone.name,
      translation: [bone.position.x, bone.position.y, bone.position.z],
      rotation: [x, y, z, w],
      scale: [bone.scale.x, bone.scale.y, bone.scale.z],
      children: []
    });
  });
  model.bones.forEach((bone, i) => {
    if (bone.parentIndex >= 0) nodes[bone.parentIndex].children.push(i);
  });

  const materials = model.materialNames.map((materialName) => ({ name: materialName }));

  model.meshes.forEach((mesh, meshIndex) => {
    const vertexCount = mesh.positions.length / 3;
    const posBufferView = addBufferView(buffer.pushFloats(mesh.positions), ARRAY_BUFFER);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const v = mesh.positions[i * 3 + axis];
        if (v < min[axis]) min[axis] = v;
        if (v > max[axis]) max[axis] = v;
      }
    }
    const posAccessor = accessors.length;
    accessors.push({ bufferView: posBufferView, componentType: GLTF_FLOAT, count: vertexCount, type: "VEC3", min, max });

    const attributes: Record<string, number> = { POSITION: posAccessor };
    if (mesh.uvs) {
      const uvBufferView = addBufferView(buffer.pushFloats(mesh.uvs), ARRAY_BUFFER);
      attributes.TEXCOORD_0 = accessors.length;
      accessors.push({ bufferView: uvBufferView, componentType: GLTF_FLOAT, count: vertexCount, type: "VEC2" });
    }

    const idx = buffer.pushIndices(mesh.indices);
    const idxBufferView = addBufferView(idx, ELEMENT_ARRAY_BUFFER);
    const idxAccessor = accessors.length;
    accessors.push({ bufferView: idxBufferView, componentType: idx.componentType, count: mesh.indices.length, type: "SCALAR" });

    const primitive: Record<string, unknown> = { attributes, indices: idxAccessor };
    if (mesh.materialIndex < materials.length) primitive.material = mesh.materialIndex;
    meshesJson.push({ name: `${name}_mesh${meshIndex}`, primitives: [primitive] });

    const meshNodeIndex = nodes.length;
    nodes.push({ name: `${name}_mesh${meshIndex}`, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], mesh: meshesJson.length - 1, children: [] });
    nodes[mesh.boneIndex].children.push(meshNodeIndex);
  });

  const animations: Record<string, unknown>[] = [];
  if (animation) {
    const times = Array.from({ length: animation.numFrames }, (_, frame) => frame / fps);
    const timeBufferView = addBufferView(buffer.pushFloats(times));
    const timeAccessor = accessors.length;
    accessors.push({ bufferView: timeBufferView, componentType: GLTF_FLOAT, count: times.length, type: "SCALAR", min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] });

    const samplers: Record<string, unknown>[] = [];
    const channels: Record<string, unknown>[] = [];
    const addChannel = (node: number, path: string, values: number[], type: "VEC3" | "VEC4"): void => {
      const bufferView = addBufferView(buffer.pushFloats(values));
      const accessor = accessors.length;
      accessors.push({ bufferView, componentType: GLTF_FLOAT, count: values.length / (type === "VEC3" ? 3 : 4), type });
      const sampler = samplers.length;
      samplers.push({ input: timeAccessor, output: accessor, interpolation: "LINEAR" });
      channels.push({ sampler, target: { node, path } });
    };

    for (const track of animation.tracks) {
      if (track.translation) addChannel(track.boneIndex, "translation", track.translation.flatMap((v) => [v.x, v.y, v.z]), "VEC3");
      if (track.rotation) addChannel(track.boneIndex, "rotation", track.rotation.flatMap((euler) => singleAxisEulerToQuaternion(euler)), "VEC4");
      if (track.scale) addChannel(track.boneIndex, "scale", track.scale.flatMap((v) => [v.x, v.y, v.z]), "VEC3");
    }
    if (channels.length > 0) animations.push({ name: "Animation", samplers, channels });
  }

  const rootNodes = model.bones.map((_, i) => i).filter((i) => model.bones[i].parentIndex < 0);
  const json = {
    asset: { version: "2.0", generator: "Good Stuff DS Game Maker" },
    scene: 0,
    scenes: [{ nodes: rootNodes }],
    nodes,
    meshes: meshesJson,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: buffer.toBytes().length }],
    ...(animations.length > 0 ? { animations } : {})
  };

  const jsonChunk = writeChunk("JSON", toJsonChunk(json));
  const binChunk = writeChunk("BIN\0", toBinChunk(buffer.toBytes()));
  const totalLength = 12 + jsonChunk.length + binChunk.length;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  out.set(jsonChunk, 12);
  out.set(binChunk, 12 + jsonChunk.length);
  return out;
}
