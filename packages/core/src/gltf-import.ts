import type { Animation, AnimationKey, AnimationTrack } from "./animation";
import { MAX_IMPORTED_COORDINATE, type ImportedMesh, type ImportedMeshSkin } from "./imported-mesh";
import { meshColorFromLevels } from "./mesh-color";
import { createSceneNode, type SceneNode, type Vector3 } from "./scene-node";

/**
 * Importing a rigged model from a glTF file (.glb, or .gltf with its buffers) as a **scene**: requirements/scene-designer/STORY.rigged-models.md.
 *
 * The DS has no skinning hardware, but it draws a model made of bones by drawing each bone's triangles with that bone's matrix (what Mario Kart DS does). So the file's skeleton
 * becomes a tree of `Node3D` bone nodes (with the file's rest pose as their transforms), and every triangle is given to **one bone** (the one that pulls its vertices hardest) and drawn as
 * a `MeshInstance3D` under that bone, its vertices in the bone's own space. Nothing new is needed to draw or animate it: the bones are ordinary nodes, so an AnimationPlayer (or a script) moves
 * them, and the file's animation clips arrive as an AnimationPlayer's animations, sampled at a fixed rate and thinned to the keys that matter.
 *
 * Supported: triangle meshes, skins (up to four bones a vertex; the strongest wins), node hierarchy with translation/rotation/scale or a matrix, animation clips of translation, rotation and scale
 * (linear, step and cubic spline), material base colors. Not supported: textures, morph targets, cameras and lights, sparse accessors, and animations of anything but bones' and nodes' transforms.
 */

/** How many keys a second a clip is sampled at before thinning (the DS plays its animations at the game's frame rate; this is plenty for a walk cycle). */
export const GLTF_SAMPLE_RATE = 15;

/**
 * The overall size (its bounding box's largest extent) a model is normalized to when its file's own raw vertex
 * data forces a rescale (see `build`'s own comment on this below) -- "a person about 2 units tall" is right for
 * this engine's own unit convention, same as this file used to say in its old, rejecting error message.
 */
const TARGET_IMPORT_EXTENT = 2;

type Json = Record<string, unknown>;

export interface GltfInput {
  /** The parsed .gltf JSON (or the JSON chunk of a .glb). */
  json: Json;
  /** The buffers the file's `buffers` list names, in order (a .glb's is its binary chunk). */
  buffers: Uint8Array[];
}

/** The pieces of a .glb file: its JSON and the binary chunk. */
export function readGlb(bytes: Uint8Array): { ok: true; input: GltfInput } | { ok: false; error: string } {
  if (bytes.length < 20) return { ok: false, error: "This file is too short to be a .glb." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return { ok: false, error: "This isn't a .glb file (it doesn't start with the glTF header)." };
  if (view.getUint32(4, true) !== 2) return { ok: false, error: "Only glTF version 2 is supported." };
  let json: Json | null = null;
  let binary: Uint8Array | null = null;
  let offset = 12;
  const end = Math.min(bytes.length, view.getUint32(8, true));
  while (offset + 8 <= end) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a && !json) {
      try {
        json = JSON.parse(new TextDecoder().decode(chunk)) as Json;
      } catch {
        return { ok: false, error: "The .glb's JSON couldn't be read." };
      }
    } else if (type === 0x004e4942 && !binary) {
      binary = chunk;
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) return { ok: false, error: "The .glb has no JSON chunk." };
  return { ok: true, input: { json, buffers: binary ? [binary] : [] } };
}

/** The uris of the files a .gltf refers to besides itself (its buffers that aren't data in the JSON), so the caller can read them. Empty for a .glb. */
export function externalGltfFiles(bytes: Uint8Array): string[] {
  if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46546c67) return [];
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
    return arr(json.buffers)
      .map((buffer) => (typeof buffer.uri === "string" ? buffer.uri : ""))
      .filter((uri) => uri !== "" && !uri.startsWith("data:"))
      .map((uri) => decodeURIComponent(uri));
  } catch {
    return [];
  }
}

/** Reads a .glb, or a .gltf with its buffers (`files` are the external ones by their uri, as `externalGltfFiles` listed them). */
export function readGltfFile(bytes: Uint8Array, files: Record<string, Uint8Array> = {}): { ok: true; input: GltfInput } | { ok: false; error: string } {
  if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46546c67) return readGlb(bytes);
  let json: Json;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
  } catch {
    return { ok: false, error: "This isn't a .glb or .gltf file." };
  }
  if (!json.asset) return { ok: false, error: "This isn't a glTF file (it has no asset section)." };
  const buffers: Uint8Array[] = [];
  for (const buffer of arr(json.buffers)) {
    const uri = typeof buffer.uri === "string" ? buffer.uri : "";
    if (uri.startsWith("data:")) {
      const base64 = uri.slice(uri.indexOf(",") + 1);
      const binary = atob(base64);
      buffers.push(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    } else {
      const file = files[decodeURIComponent(uri)];
      if (!file) return { ok: false, error: `The file needs "${uri}" beside it, which couldn't be read.` };
      buffers.push(file);
    }
  }
  return { ok: true, input: { json, buffers } };
}

export interface RiggedModel {
  /** A `Node3D` named for the model: the file's node tree (bones and all), the meshes under their bones, and an AnimationPlayer when the file has clips. */
  root: SceneNode;
  /** The models the meshes use: one for each bone that has triangles. */
  meshes: ImportedMesh[];
  boneCount: number;
  triangleCount: number;
  clipNames: string[];
}

export type ImportGltfResult = { ok: true; model: RiggedModel; warnings: string[] } | { ok: false; errors: string[] };

// ---- Small math: column-major 4x4 matrices (element [column * 4 + row]) like the compiler's, and quaternions as [x, y, z, w].

type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function composeTRS(t: number[], q: number[], s: number[]): Mat {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1
  ];
}

function decompose(m: Mat): { t: number[]; q: number[]; s: number[] } {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  let sz = Math.hypot(m[8], m[9], m[10]);
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) sz = -sz;
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz]; // columns of the rotation
  const trace = r[0] + r[4] + r[8];
  let q: number[];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(r[5] - r[7]) * s, (r[6] - r[2]) * s, (r[1] - r[3]) * s, 0.25 / s];
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = 2 * Math.sqrt(1 + r[0] - r[4] - r[8]);
    q = [0.25 * s, (r[3] + r[1]) / s, (r[6] + r[2]) / s, (r[5] - r[7]) / s];
  } else if (r[4] > r[8]) {
    const s = 2 * Math.sqrt(1 + r[4] - r[0] - r[8]);
    q = [(r[3] + r[1]) / s, 0.25 * s, (r[7] + r[5]) / s, (r[6] - r[2]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + r[8] - r[0] - r[4]);
    q = [(r[6] + r[2]) / s, (r[7] + r[5]) / s, 0.25 * s, (r[1] - r[3]) / s];
  }
  return { t: [m[12], m[13], m[14]], q, s: [sx, sy, sz] };
}

function multiplyMat(a: Mat, b: Mat): Mat {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function transformPoint(m: Mat, p: readonly [number, number, number]): [number, number, number] {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

/** `m`'s own linear 3x3 part applied to `v`, with no translation added -- for un-doing an inverse's translation below. */
function transformVector(m: Mat, v: readonly [number, number, number]): [number, number, number] {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

/** The inverse of an affine matrix (translation + any invertible linear part; every matrix this file builds or reads qualifies). A singular matrix (a zero-scaled bone) inverts to all zeros rather than throwing or producing NaN. */
function invertAffine(m: Mat): Mat {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const invDet = det !== 0 ? 1 / det : 0;
  const inv: Mat = [
    (e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet, 0,
    (f * g - d * i) * invDet, (a * i - c * g) * invDet, (b * g - a * h) * invDet, 0,
    (d * h - e * g) * invDet, (c * d - a * f) * invDet, (a * e - b * d) * invDet, 0,
    0, 0, 0, 1
  ];
  const t = transformVector(inv, [m[12], m[13], m[14]]);
  inv[12] = -t[0];
  inv[13] = -t[1];
  inv[14] = -t[2];
  return inv;
}

const RAD_TO_DEG = 180 / Math.PI;

/** The Euler angles in degrees, in the editor's `XYZ` order (`Rx · Ry · Rz`), of a unit quaternion. */
export function quaternionToEulerXYZ(q: number[]): Vector3 {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const by = Math.asin(Math.max(-1, Math.min(1, m13)));
  let bx: number, bz: number;
  if (Math.abs(m13) < 0.9999999) {
    bx = Math.atan2(-m23, m33);
    bz = Math.atan2(-m12, m11);
  } else {
    bx = Math.atan2(m32, m22);
    bz = 0;
  }
  return { x: bx * RAD_TO_DEG, y: by * RAD_TO_DEG, z: bz * RAD_TO_DEG };
}

const normalizeQ = (q: number[]): number[] => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};

function slerp(a: number[], b: number[], t: number): number[] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target = dot < 0 ? b.map((v) => -v) : b;
  if (dot < 0) dot = -dot;
  if (dot > 0.9995) return normalizeQ(a.map((v, i) => v + (target[i] - v) * t));
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return a.map((v, i) => v * wa + target[i] * wb);
}

// ---- Reading the file's accessors

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const arr = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);

interface Accessor {
  data: number[];
  count: number;
  size: number;
}

function readAccessor(input: GltfInput, index: number): Accessor {
  const accessor = arr(input.json.accessors)[index];
  if (!accessor) throw new Error(`The file refers to an accessor (${index}) it doesn't have.`);
  if (accessor.sparse) throw new Error("Sparse accessors aren't supported.");
  const size = COMPONENTS[String(accessor.type)];
  if (!size) throw new Error(`Unknown accessor type "${String(accessor.type)}".`);
  const count = num(accessor.count, 0);
  const componentType = num(accessor.componentType, 5126);
  const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[componentType as 5120];
  if (!bytes) throw new Error(`Unknown component type ${componentType}.`);
  const data = new Array<number>(count * size);
  if (accessor.bufferView === undefined) return { data: data.fill(0), count, size };
  const view = arr(input.json.bufferViews)[num(accessor.bufferView, 0)];
  if (!view) throw new Error("The file refers to a buffer view it doesn't have.");
  const buffer = input.buffers[num(view.buffer, 0)];
  if (!buffer) throw new Error("The file's data isn't all there (a buffer is missing).");
  const stride = num(view.byteStride, 0) || bytes * size;
  const base = buffer.byteOffset + num(view.byteOffset, 0) + num(accessor.byteOffset, 0);
  const dv = new DataView(buffer.buffer);
  const normalized = accessor.normalized === true;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < size; c++) {
      const at = base + i * stride + c * bytes;
      let v: number;
      switch (componentType) {
        case 5120: v = dv.getInt8(at); if (normalized) v = Math.max(v / 127, -1); break;
        case 5121: v = dv.getUint8(at); if (normalized) v /= 255; break;
        case 5122: v = dv.getInt16(at, true); if (normalized) v = Math.max(v / 32767, -1); break;
        case 5123: v = dv.getUint16(at, true); if (normalized) v /= 65535; break;
        case 5125: v = dv.getUint32(at, true); break;
        default: v = dv.getFloat32(at, true);
      }
      data[i * size + c] = v;
    }
  }
  return { data, count, size };
}

// ---- The import

interface BuiltMesh {
  name: string;
  positions: number[];
  normals: number[];
  indices: number[];
  material: number;
  skin?: ImportedMeshSkin;
  smoothSkinning?: boolean;
}

/** Puts a triangle's normals right for a vertex table that has none: the average of the faces around each vertex. */
function faceNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v + k] += n[k];
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v + k] /= len;
  }
  return normals;
}

function baseColor(json: Json, materialIndex: number): string | undefined {
  const material = arr(json.materials)[materialIndex];
  const factor = (material?.pbrMetallicRoughness as Json | undefined)?.baseColorFactor;
  if (!Array.isArray(factor) || factor.length < 3) return undefined;
  const srgb = (c: number): number => Math.round(Math.pow(Math.min(1, Math.max(0, num(c, 1))), 1 / 2.2) * 31);
  const levels: [number, number, number] = [srgb(factor[0]), srgb(factor[1]), srgb(factor[2])];
  return levels.every((l) => l >= 30) ? undefined : meshColorFromLevels(levels);
}

export interface ImportGltfOptions {
  /** Skip the usual "every triangle to the one bone that pulls it hardest" split (STORY.rigged-models.md) and
   * instead keep each skinned glTF primitive as one unified `MeshInstance3D`, with its own full per-vertex,
   * possibly-many-bone weighting and `smoothSkinning` already on. The per-bone split exists only so the DS's
   * bone-free GPU can still show a *rigid* model's joints moving at all -- a model going smooth-skinned doesn't
   * need it, and splitting one anyway only fragments it into more draw calls and, worse, feeds the compiler's own
   * per-mesh smooth-skinning optimizations (STORY.smooth-vertex-skinning.md's triangle reordering and blend-group
   * cap) smaller, more fragmented pieces than a unified mesh would give them. See `importRiggedModel`
   * (editor-store.tsx), which re-imports with this on once the user confirms they want smooth skinning. */
  unifiedSkinning?: boolean;
}

/**
 * Turns a glTF file into a rigged model. Never throws: a file that can't be used comes back as errors. `name` is what the model is called (the file's name without its extension).
 */
export function importGltf(input: GltfInput, name: string, options: ImportGltfOptions = {}): ImportGltfResult {
  try {
    return build(input, name, options);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function build(input: GltfInput, modelName: string, options: ImportGltfOptions): ImportGltfResult {
  const { json } = input;
  const warnings: string[] = [];
  const gltfNodes = arr(json.nodes);
  if (gltfNodes.length === 0) return { ok: false, errors: ["The file has no nodes, so there is nothing to import."] };
  const scenes = arr(json.scenes);
  const sceneRoots: number[] = (scenes[num(json.scene, 0)]?.nodes as number[] | undefined) ?? gltfNodes.map((_, i) => i).filter((i) => !gltfNodes.some((n) => (n.children as number[] | undefined)?.includes(i)));

  const sceneNodes = new Map<number, SceneNode>();
  const localMatrix = new Map<number, Mat>();
  const skinnedMeshNodes: number[] = [];
  const meshes: ImportedMesh[] = [];
  /** Which gltf node (bone, or the mesh's own node when unskinned) each built mesh's positions are local to -- for measuring the model's real, overall world-space size once the whole tree's world matrices are known. */
  const meshOwner = new Map<string, number>();
  let triangleCount = 0;

  const restOf = (node: Json): { t: number[]; q: number[]; s: number[] } => {
    if (Array.isArray(node.matrix) && node.matrix.length === 16) return decompose(node.matrix as number[]);
    return {
      t: (node.translation as number[] | undefined) ?? [0, 0, 0],
      q: normalizeQ((node.rotation as number[] | undefined) ?? [0, 0, 0, 1]),
      s: (node.scale as number[] | undefined) ?? [1, 1, 1]
    };
  };

  const addMesh = (parent: SceneNode, ownerIndex: number, built: BuiltMesh): void => {
    const mesh: ImportedMesh = {
      id: crypto.randomUUID(),
      name: `${modelName}_${built.name}`,
      positions: built.positions,
      normals: built.normals,
      indices: built.indices,
      ...(built.skin ? { skin: built.skin } : {})
    };
    meshes.push(mesh);
    meshOwner.set(mesh.id, ownerIndex);
    const triangles = built.indices.length / 3;
    triangleCount += triangles;
    const node = createSceneNode({ name: built.name, kind: "MeshInstance3D" });
    const color = baseColor(json, built.material);
    node.mesh = { importedMeshId: mesh.id, triangleCount: triangles, ...(color ? { color } : {}), ...(built.smoothSkinning ? { smoothSkinning: true } : {}) };
    parent.children.push(node);
  };

  /** A primitive's triangles as one vertex table in its own space, or grouped by bone when `groups` says how. */
  const readPrimitive = (primitive: Json, label: string) => {
    const attributes = (primitive.attributes ?? {}) as Record<string, number>;
    if (attributes.POSITION === undefined) throw new Error(`"${label}" has a mesh with no positions.`);
    if (primitive.mode !== undefined && primitive.mode !== 4) {
      warnings.push(`"${label}" has a mesh drawn as strips, fans or lines, which isn't supported; it was skipped.`);
      return null;
    }
    const positions = readAccessor(input, attributes.POSITION);
    const normals = attributes.NORMAL !== undefined ? readAccessor(input, attributes.NORMAL) : null;
    const joints = attributes.JOINTS_0 !== undefined ? readAccessor(input, attributes.JOINTS_0) : null;
    const weights = attributes.WEIGHTS_0 !== undefined ? readAccessor(input, attributes.WEIGHTS_0) : null;
    const indices = primitive.indices !== undefined ? readAccessor(input, num(primitive.indices, 0)).data : Array.from({ length: positions.count }, (_, i) => i);
    return { positions, normals, joints, weights, indices, material: num(primitive.material, -1) };
  };

  // 1. The node tree (bones and everything else), meshes that aren't skinned drawn where they are.
  const buildNode = (index: number, seen: Set<number>): SceneNode => {
    if (seen.has(index)) throw new Error("The file's nodes contain a loop.");
    seen.add(index);
    const source = gltfNodes[index];
    const rest = restOf(source);
    const nodeName = typeof source.name === "string" && source.name !== "" ? source.name : `Node${index}`;
    const node = createSceneNode({
      name: nodeName,
      kind: "Node3D",
      transform3D: { position: { x: rest.t[0], y: rest.t[1], z: rest.t[2] }, rotation: quaternionToEulerXYZ(rest.q), scale: { x: rest.s[0], y: rest.s[1], z: rest.s[2] } }
    });
    sceneNodes.set(index, node);
    localMatrix.set(index, composeTRS(rest.t, rest.q, rest.s));
    if (source.mesh !== undefined && source.skin !== undefined) skinnedMeshNodes.push(index);
    else if (source.mesh !== undefined) {
      const gltfMesh = arr(json.meshes)[num(source.mesh, 0)];
      arr(gltfMesh?.primitives).forEach((primitive, p) => {
        const read = readPrimitive(primitive, nodeName);
        if (!read) return;
        const positions = Array.from(read.positions.data);
        const normals = read.normals ? Array.from(read.normals.data) : faceNormals(positions, read.indices);
        const partName = arr(gltfMesh?.primitives).length > 1 ? `${nodeName}_${p}` : `${nodeName}_mesh`;
        addMesh(node, index, { name: partName, positions, normals, indices: read.indices, material: read.material });
      });
    }
    for (const child of (source.children as number[] | undefined) ?? []) node.children.push(buildNode(child, seen));
    return node;
  };
  const seen = new Set<number>();
  const rootChildren = sceneRoots.map((index) => buildNode(index, seen));

  // Every node's world matrix (as the file's own node tree says, before any rescale below), for measuring the
  // model's real overall size -- same tree shape `buildNode` already walked, so `localMatrix` is complete by now.
  const worldMatrix = new Map<number, Mat>();
  const computeWorldMatrices = (index: number, parentWorld: Mat): void => {
    const world = multiplyMat(parentWorld, localMatrix.get(index)!);
    worldMatrix.set(index, world);
    for (const child of (gltfNodes[index].children as number[] | undefined) ?? []) computeWorldMatrices(child, world);
  };
  for (const index of sceneRoots) computeWorldMatrices(index, IDENTITY);

  // 2. Skinned meshes: each triangle goes to the bone that pulls its vertices hardest, in that bone's own space.
  const jointNodes = new Set<number>();
  for (const meshNode of skinnedMeshNodes) {
    const source = gltfNodes[meshNode];
    const skin = arr(json.skins)[num(source.skin, 0)];
    const joints = ((skin?.joints as number[] | undefined) ?? []).slice();
    if (joints.length === 0) throw new Error("A skin has no bones.");
    for (const joint of joints) {
      if (!sceneNodes.has(joint)) throw new Error("A bone isn't part of the scene the file shows.");
      jointNodes.add(joint);
    }
    const inverseBind: Mat[] =
      skin.inverseBindMatrices !== undefined
        ? (() => {
            const data = readAccessor(input, num(skin.inverseBindMatrices, 0)).data;
            return joints.map((_, j) => data.slice(j * 16, j * 16 + 16));
          })()
        : joints.map(() => IDENTITY);
    const gltfMesh = arr(json.meshes)[num(source.mesh, 0)];
    const label = typeof source.name === "string" ? source.name : `Node${meshNode}`;

    if (options.unifiedSkinning) {
      // One `MeshInstance3D` per primitive, parented to the mesh's own node (not any one bone) -- no per-triangle
      // dominant-bone grouping, and no rebasing of positions or inverse bind matrices into any bone's space.
      // glTF's own raw per-primitive vertex data and its skin's raw inverseBindMatrices are already defined in one
      // consistent space by the format itself, so leaving both alone is what makes this correct with zero new
      // matrix math: draw_skinned_mesh's own runtime blend (main.c) is `world[bone] * invBind[bone] * position`,
      // which this data already satisfies directly.
      const node = sceneNodes.get(meshNode)!;
      arr(gltfMesh?.primitives).forEach((primitive, p) => {
        const read = readPrimitive(primitive, label);
        if (!read) return;
        if (!read.joints || !read.weights) warnings.push(`"${label}" has a mesh with a skin but no bone weights; it is attached to the first bone.`);
        const positions = Array.from(read.positions.data);
        const normals = read.normals ? Array.from(read.normals.data) : faceNormals(positions, read.indices);
        const vertexCount = positions.length / 3;
        // Every bone this primitive's vertices actually reference, gathered into a small per-mesh list -- same
        // jointNodeIds/localJointIndex/globalJointIndices bookkeeping the dominant-bone split path below uses,
        // just scoped to the whole primitive instead of one dominant-bone group.
        const jointNodeIds: string[] = [];
        const globalJointIndices: number[] = [];
        const localJointIndex = new Map<number, number>();
        const skinJoints: number[] = [];
        const skinWeights: number[] = [];
        for (let v = 0; v < vertexCount; v++) {
          const raw =
            read.joints && read.weights
              ? Array.from({ length: 4 }, (_, k) => ({ g: read.joints!.data[v * 4 + k], w: read.weights!.data[v * 4 + k] }))
              : [{ g: 0, w: 1 }];
          const sum = raw.reduce((s, r) => s + r.w, 0) || 1;
          for (let k = 0; k < 4; k++) {
            const { g, w } = raw[k] ?? { g: 0, w: 0 };
            if (w <= 0) {
              skinJoints.push(0);
              skinWeights.push(0);
              continue;
            }
            let local = localJointIndex.get(g);
            if (local === undefined) {
              local = jointNodeIds.length;
              localJointIndex.set(g, local);
              jointNodeIds.push(sceneNodes.get(joints[g])!.id);
              globalJointIndices.push(g);
            }
            skinJoints.push(local);
            skinWeights.push(w / sum);
          }
        }
        const inverseBindMatrices = globalJointIndices.flatMap((g) => inverseBind[g] ?? IDENTITY);
        const skin: ImportedMeshSkin = { jointNodeIds, inverseBindMatrices, joints: skinJoints, weights: skinWeights };
        const partName = arr(gltfMesh?.primitives).length > 1 ? `${label}_${p}` : `${label}_mesh`;
        addMesh(node, meshNode, { name: partName, positions, normals, indices: read.indices, material: read.material, skin, smoothSkinning: true });
      });
      continue;
    }

    const groups = new Map<
      string,
      {
        joint: number;
        material: number;
        vertexMap: Map<number, number>;
        positions: number[];
        normals: number[];
        indices: number[];
        noNormals: boolean;
        /** The real, possibly-multi-bone weighting every vertex in this group actually has, for a later `smoothSkinning` toggle -- see `ImportedMeshSkin`'s own doc comment. `jointNodeIds`/`globalJointIndices` grow together as new bones are seen (same length, same order); `localJointIndex` is their reverse lookup; `skinJoints`/`skinWeights` are 4 entries per vertex, same order as `positions`. */
        jointNodeIds: string[];
        globalJointIndices: number[];
        localJointIndex: Map<number, number>;
        skinJoints: number[];
        skinWeights: number[];
      }
    >();
    for (const primitive of arr(gltfMesh?.primitives)) {
      const read = readPrimitive(primitive, label);
      if (!read) continue;
      if (!read.joints || !read.weights) warnings.push(`"${label}" has a mesh with a skin but no bone weights; it is attached to the first bone.`);
      for (let t = 0; t + 2 < read.indices.length; t += 3) {
        const tri = [read.indices[t], read.indices[t + 1], read.indices[t + 2]];
        const pull = new Map<number, number>();
        for (const v of tri) {
          if (!read.joints || !read.weights) continue;
          for (let k = 0; k < 4; k++) {
            const joint = read.joints.data[v * 4 + k];
            pull.set(joint, (pull.get(joint) ?? 0) + read.weights.data[v * 4 + k]);
          }
        }
        let best = 0;
        let bestPull = -1;
        for (const [joint, weight] of pull) if (weight > bestPull) [best, bestPull] = [joint, weight];
        const key = `${best}|${read.material}`;
        let group = groups.get(key);
        if (!group) {
          group = { joint: best, material: read.material, vertexMap: new Map(), positions: [], normals: [], indices: [], noNormals: !read.normals, jointNodeIds: [], globalJointIndices: [], localJointIndex: new Map(), skinJoints: [], skinWeights: [] };
          groups.set(key, group);
        }
        const ibm = inverseBind[best] ?? IDENTITY;
        for (const v of tri) {
          // A vertex shared by triangles of different bones is a copy in each bone's table (its position is in that bone's space).
          let mapped = group.vertexMap.get(v);
          if (mapped === undefined) {
            mapped = group.positions.length / 3;
            group.vertexMap.set(v, mapped);
            const p = [read.positions.data[v * 3], read.positions.data[v * 3 + 1], read.positions.data[v * 3 + 2]];
            group.positions.push(
              ibm[0] * p[0] + ibm[4] * p[1] + ibm[8] * p[2] + ibm[12],
              ibm[1] * p[0] + ibm[5] * p[1] + ibm[9] * p[2] + ibm[13],
              ibm[2] * p[0] + ibm[6] * p[1] + ibm[10] * p[2] + ibm[14]
            );
            if (read.normals) {
              const n = [read.normals.data[v * 3], read.normals.data[v * 3 + 1], read.normals.data[v * 3 + 2]];
              const local = [ibm[0] * n[0] + ibm[4] * n[1] + ibm[8] * n[2], ibm[1] * n[0] + ibm[5] * n[1] + ibm[9] * n[2], ibm[2] * n[0] + ibm[6] * n[1] + ibm[10] * n[2]];
              const len = Math.hypot(local[0], local[1], local[2]) || 1;
              group.normals.push(local[0] / len, local[1] / len, local[2] / len);
            } else {
              group.normals.push(0, 0, 0);
            }
            // This vertex's real (up to 4-bone) weighting, normalized to sum to 1; no weight data at all falls back
            // to "fully on this group's own dominant bone" (same effective result as the rigid path).
            const raw =
              read.joints && read.weights
                ? Array.from({ length: 4 }, (_, k) => ({ g: read.joints!.data[v * 4 + k], w: read.weights!.data[v * 4 + k] }))
                : [{ g: best, w: 1 }];
            const sum = raw.reduce((s, r) => s + r.w, 0) || 1;
            for (let k = 0; k < 4; k++) {
              const { g, w } = raw[k] ?? { g: 0, w: 0 };
              if (w <= 0) {
                group.skinJoints.push(0);
                group.skinWeights.push(0);
                continue;
              }
              let local = group.localJointIndex.get(g);
              if (local === undefined) {
                local = group.jointNodeIds.length;
                group.localJointIndex.set(g, local);
                group.jointNodeIds.push(sceneNodes.get(joints[g])!.id);
                group.globalJointIndices.push(g);
              }
              group.skinJoints.push(local);
              group.skinWeights.push(w / sum);
            }
          }
          group.indices.push(mapped);
        }
      }
    }
    for (const group of groups.values()) {
      const boneIndex = joints[group.joint] ?? joints[0];
      const bone = sceneNodes.get(boneIndex)!;
      const normals = group.noNormals ? faceNormals(group.positions, group.indices) : group.normals;
      const partName = `${bone.name}_mesh${groups.size > joints.length ? `_${group.material}` : ""}`;
      // Re-expresses every referenced bone's inverse bind matrix relative to this group's own dominant bone (the
      // same space `group.positions` is already stored in), so the smooth-skinning blend at runtime can apply it
      // directly to the stored position with no further change of space: worldVertex = Σ weight_i * jointWorld_i(now)
      // * (invBind_i * dominantBoneBindWorld) * group.positions[v]. `dominantBoneBindWorld` is the inverse of this
      // group's own `ibm` (the dominant bone's bind-pose world matrix) -- see `invertAffine`'s own doc comment.
      const dominantBoneBindWorld = invertAffine(inverseBind[group.joint] ?? IDENTITY);
      const inverseBindMatrices = group.globalJointIndices.flatMap((g) => multiplyMat(inverseBind[g] ?? IDENTITY, dominantBoneBindWorld));
      const skin: ImportedMeshSkin = { jointNodeIds: group.jointNodeIds, inverseBindMatrices, joints: group.skinJoints, weights: group.skinWeights };
      addMesh(bone, boneIndex, { name: partName, positions: group.positions, normals, indices: group.indices, material: group.material, skin });
    }
  }

  // Every mesh's vertex positions are in the bone they're attached to's own local space (real units, same as the
  // file), and the DS GPU's vertex format (VTX_16) can't represent a raw coordinate past MAX_IMPORTED_COORDINATE --
  // that's a hardware limit on the *raw* numbers a bone's matrix multiplies (the DS's own fixed-point conversion,
  // `toV16`, throws if a mesh's stored position doesn't fit it, with no fallback -- see fixed-point.ts), not on the
  // model's apparent size, so scaling the whole rig down visually in the source file doesn't help unless that scale
  // is actually baked into the mesh and armature data (e.g. Blender's "Apply Transform"); the file's raw
  // vertex-to-bone distances are the same either way.
  //
  // A single bone-local vertex offset past that limit is also a strong sign the *whole file* was authored in units
  // this engine doesn't expect (centimeters, say, from a Mixamo export with no unit correction applied) -- no
  // reasonably-proportioned "person about 2 units tall" model would ever need one. So rather than just barely
  // satisfying the hardware limit, the whole model is scaled down by whichever is bigger: the hardware-driven
  // factor, or whatever's needed to bring its real world-space bounding box (every bone's own world transform,
  // composed from the file's node tree) down to TARGET_IMPORT_EXTENT. And rather than compensating with an inverse
  // scale on the model's own wrapping root node (which would exactly cancel the shrink back out -- the file's
  // original, too-big-for-this-engine size is exactly the thing being corrected here, not preserved), every
  // bone/node's own rest position *and* mesh vertex data are divided by the same factor, uniformly, same as if the
  // whole rig had actually been scaled down in the source file before export; animation position keyframes get the
  // same treatment below, once they're built, so a moving bone still ends up in the right (now smaller) place.
  let rescale = 1;
  let maxAbs = 0;
  for (const mesh of meshes) for (const c of mesh.positions) maxAbs = Math.max(maxAbs, Math.abs(c));
  if (maxAbs > MAX_IMPORTED_COORDINATE) {
    const bboxMin = [Infinity, Infinity, Infinity];
    const bboxMax = [-Infinity, -Infinity, -Infinity];
    for (const mesh of meshes) {
      const world = worldMatrix.get(meshOwner.get(mesh.id)!) ?? IDENTITY;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const p = transformPoint(world, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
        for (let k = 0; k < 3; k++) {
          bboxMin[k] = Math.min(bboxMin[k], p[k]);
          bboxMax[k] = Math.max(bboxMax[k], p[k]);
        }
      }
    }
    const extent = Math.max(bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]);
    const normalizeScale = extent > 0 ? extent / TARGET_IMPORT_EXTENT : 1;
    const hardwareScale = maxAbs / (MAX_IMPORTED_COORDINATE - 0.5);
    rescale = Math.max(normalizeScale, hardwareScale);
    for (const mesh of meshes) for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] /= rescale;
    // A skin's own inverse-bind matrices carry a real position offset too (in the file's original, un-rescaled
    // units) -- only their translation (indices 12-14) needs dividing, same as a node's own position; the
    // rotation/scale linear part isn't a distance, so it's unaffected by a uniform rescale. Missing this exact
    // fix once already produced vertices thrown wildly out of place at runtime (the blend's bone-world-matrix side
    // was already shrunk, but this side wasn't, so the two no longer agreed on what "one unit" meant).
    for (const mesh of meshes) {
      if (!mesh.skin) continue;
      for (let m = 0; m < mesh.skin.inverseBindMatrices.length; m += 16) {
        mesh.skin.inverseBindMatrices[m + 12] /= rescale;
        mesh.skin.inverseBindMatrices[m + 13] /= rescale;
        mesh.skin.inverseBindMatrices[m + 14] /= rescale;
      }
    }
    const scalePositions = (scaled: SceneNode): void => {
      if (scaled.transform3D) {
        scaled.transform3D.position.x /= rescale;
        scaled.transform3D.position.y /= rescale;
        scaled.transform3D.position.z /= rescale;
      }
      scaled.children.forEach(scalePositions);
    };
    rootChildren.forEach(scalePositions);
    // `rescale` can run bigger than the model's true visual size actually calls for, when a node somewhere in its
    // tree (a Mixamo "Armature" wrapper, say) already carries its own unrelated scale (e.g. a 0.01 cm-to-m
    // conversion): `hardwareScale` reacts to the *raw*, pre-that-scale vertex-to-bone distance (a hardware format
    // limit on the stored number itself, unaffected by any node's scale -- see the comment above), so it can run far
    // higher than `normalizeScale`, the shrink the model's already-scaled real size actually needs. Dividing every
    // position by the bigger, hardware-driven `rescale` (above, unchanged from before) keeps mesh vertices and bone
    // positions in step with each other, but shrinks the model's *true rendered size* by `rescale`, not just the
    // `normalizeScale` its real size called for -- found on a real file where the true rendered height came out to
    // about a tenth of a unit instead of two, making the smooth-skinning blend's fixed-point rounding (a fixed
    // ~1/4096-unit step) big enough, relative to the now-tiny model, to show up as real distortion at the
    // fingertips, where rigid skinning's simpler, single-matrix math hid the same rounding. Multiplying the import's
    // own root node(s) by the ratio between the two corrects the *rendered* size back to what `normalizeScale` alone
    // would have given, without changing a single stored vertex or bone position (still safely inside the hardware
    // limit, divided by the full `rescale` above) -- 1 whenever `rescale` was already just `normalizeScale` (the
    // ordinary case, with no such unrelated scale in the tree), so an ordinary file's output is unchanged.
    const compensatingScale = rescale / normalizeScale;
    if (compensatingScale !== 1) {
      for (const root of rootChildren) {
        if (!root.transform3D) continue;
        root.transform3D.scale.x *= compensatingScale;
        root.transform3D.scale.y *= compensatingScale;
        root.transform3D.scale.z *= compensatingScale;
      }
    }
    warnings.push(
      `The model is bigger than the DS geometry engine's vertex range, so it was scaled down by ${rescale.toFixed(3)}x in the file (this engine's own convention is "a person is about 2 units tall" -- ` +
        `check the result still looks right).`
    );
  }

  // 3. The animation clips, sampled and thinned.
  const animations: Animation[] = [];
  for (const [clipIndex, clip] of arr(json.animations).entries()) {
    const samplers = arr(clip.samplers);
    const byNode = new Map<number, { translation?: number; rotation?: number; scale?: number }>();
    let duration = 0;
    for (const channel of arr(clip.channels)) {
      const target = (channel.target ?? {}) as Json;
      const path = String(target.path);
      const node = num(target.node, -1);
      if (path === "weights") {
        warnings.push(`Animation "${String(clip.name ?? clipIndex)}" animates morph weights, which aren't supported; that part was skipped.`);
        continue;
      }
      if (!sceneNodes.has(node) || !["translation", "rotation", "scale"].includes(path)) continue;
      const entry = byNode.get(node) ?? {};
      entry[path as "translation"] = num(channel.sampler, 0);
      byNode.set(node, entry);
      const times = readAccessor(input, num(samplers[num(channel.sampler, 0)]?.input, 0)).data;
      if (times.length > 0) duration = Math.max(duration, times[times.length - 1]);
    }
    if (byNode.size === 0 || duration <= 0) continue;
    const length = Math.min(600, Math.max(0.1, duration));
    const steps = Math.max(1, Math.ceil(length * GLTF_SAMPLE_RATE));
    const times = Array.from({ length: steps + 1 }, (_, k) => (k === steps ? length : k / GLTF_SAMPLE_RATE));
    const tracks: AnimationTrack[] = [];
    for (const [nodeIndex, paths] of byNode) {
      const node = sceneNodes.get(nodeIndex)!;
      const rest = restOf(gltfNodes[nodeIndex]);
      for (const path of ["translation", "rotation", "scale"] as const) {
        const samplerIndex = paths[path];
        if (samplerIndex === undefined) continue;
        const sampler = samplers[samplerIndex];
        const input0 = readAccessor(input, num(sampler.input, 0)).data;
        const outputAccessor = readAccessor(input, num(sampler.output, 0));
        const interpolation = String(sampler.interpolation ?? "LINEAR");
        const width = path === "rotation" ? 4 : 3;
        const stride = interpolation === "CUBICSPLINE" ? 3 : 1;
        const valueAt = (key: number): number[] => outputAccessor.data.slice((key * stride + (stride === 3 ? 1 : 0)) * width, (key * stride + (stride === 3 ? 1 : 0)) * width + width);
        const tangentAt = (key: number, which: 0 | 2): number[] => outputAccessor.data.slice((key * 3 + which) * width, (key * 3 + which) * width + width);
        const sample = (time: number): number[] => {
          if (input0.length === 1 || time <= input0[0]) return valueAt(0);
          const last = input0.length - 1;
          if (time >= input0[last]) return valueAt(last);
          let k = 0;
          while (k + 1 < last && input0[k + 1] <= time) k++;
          const dt = input0[k + 1] - input0[k];
          const s = dt > 0 ? (time - input0[k]) / dt : 0;
          const a = valueAt(k);
          const b = valueAt(k + 1);
          if (interpolation === "STEP") return a;
          if (interpolation === "CUBICSPLINE") {
            const [s2, s3] = [s * s, s * s * s];
            const out = a.map((v, i) => (2 * s3 - 3 * s2 + 1) * v + (s3 - 2 * s2 + s) * dt * tangentAt(k, 2)[i] + (-2 * s3 + 3 * s2) * b[i] + (s3 - s2) * dt * tangentAt(k + 1, 0)[i]);
            return path === "rotation" ? normalizeQ(out) : out;
          }
          return path === "rotation" ? slerp(normalizeQ(a), normalizeQ(b), s) : a.map((v, i) => v + (b[i] - v) * s);
        };
        // Sampled at the fixed rate; a rotation's angles are kept continuous from key to key so they don't spin the long way round.
        let previous: Vector3 | null = null;
        const keys: AnimationKey[] = times.map((time) => {
          const v = sample(time);
          if (path === "rotation") {
            const euler = quaternionToEulerXYZ(normalizeQ(v));
            if (previous) {
              for (const axis of ["x", "y", "z"] as const) {
                while (euler[axis] - previous[axis] > 180) euler[axis] -= 360;
                while (euler[axis] - previous[axis] < -180) euler[axis] += 360;
              }
            }
            previous = euler;
            return { time, value: { ...euler } };
          }
          return { time, value: { x: v[0], y: v[1], z: v[2] } };
        });
        const property = path === "translation" ? "position" : path === "rotation" ? "rotation" : "scale";
        const restValue = path === "translation" ? { x: rest.t[0], y: rest.t[1], z: rest.t[2] } : path === "rotation" ? quaternionToEulerXYZ(rest.q) : { x: rest.s[0], y: rest.s[1], z: rest.s[2] };
        const thinned = thin(keys, path === "rotation" ? 0.4 : 0.004);
        const moves = thinned.some((key) => distance(key.value as Vector3, restValue) > (path === "rotation" ? 0.4 : 0.004));
        if (!moves) continue;
        // Keeps a moving bone's keyframes in step with the rest-position rescale above (not applied any earlier,
        // so the "moves" check just above still compares against the file's own original, unscaled units).
        if (property === "position" && rescale !== 1) {
          for (const key of thinned) {
            const v = key.value as Vector3;
            v.x /= rescale;
            v.y /= rescale;
            v.z /= rescale;
          }
        }
        tracks.push({ id: crypto.randomUUID(), nodeId: node.id, property, keys: thinned });
      }
    }
    if (tracks.length === 0) continue;
    const baseName = typeof clip.name === "string" && clip.name !== "" ? clip.name : `clip${clipIndex + 1}`;
    let clipName = baseName;
    for (let n = 2; animations.some((a) => a.name === clipName); n++) clipName = `${baseName}${n}`;
    animations.push({ id: crypto.randomUUID(), name: clipName, length, loop: true, tracks });
  }

  const boneCount = jointNodes.size;
  if (meshes.length === 0) warnings.push("The file has no triangles to draw; only its nodes were imported.");
  const root = createSceneNode({ name: modelName, kind: "Node3D", children: rootChildren });
  if (animations.length > 0) {
    const player = createSceneNode({ name: "AnimationPlayer", kind: "AnimationPlayer" });
    player.animation = { speed: 1, animations };
    root.children.push(player);
  }
  const keyCount = animations.reduce((sum, a) => sum + a.tracks.reduce((s, t) => s + t.keys.length, 0), 0);
  if (keyCount > 6000) warnings.push(`The animations have ${keyCount} keys in all, which is a lot for the DS's memory; trim clips you don't need.`);
  return { ok: true, model: { root, meshes, boneCount, triangleCount, clipNames: animations.map((a) => a.name) }, warnings };
}

function distance(a: Vector3, b: Vector3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/** Drops the keys that a straight line between their neighbors would replace to within `epsilon` (the largest difference on any axis): Ramer-Douglas-Peucker over time. */
function thin(keys: AnimationKey[], epsilon: number): AnimationKey[] {
  if (keys.length <= 2) return keys;
  const keep = new Array<boolean>(keys.length).fill(false);
  keep[0] = keep[keys.length - 1] = true;
  const walk = (lo: number, hi: number): void => {
    let worst = -1;
    let at = -1;
    const a = keys[lo].value as Vector3;
    const b = keys[hi].value as Vector3;
    for (let i = lo + 1; i < hi; i++) {
      const s = (keys[i].time - keys[lo].time) / (keys[hi].time - keys[lo].time);
      const v = keys[i].value as Vector3;
      const error = Math.max(Math.abs(v.x - (a.x + (b.x - a.x) * s)), Math.abs(v.y - (a.y + (b.y - a.y) * s)), Math.abs(v.z - (a.z + (b.z - a.z) * s)));
      if (error > worst) [worst, at] = [error, i];
    }
    if (worst > epsilon && at > 0) {
      keep[at] = true;
      walk(lo, at);
      walk(at, hi);
    }
  };
  walk(0, keys.length - 1);
  return keys.filter((_, i) => keep[i]);
}
