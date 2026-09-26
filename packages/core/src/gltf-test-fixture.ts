/**
 * Test support: a small rigged model built as glTF bytes, so tests in every package can import a skinned, animated file without keeping a binary asset in the repository.
 */

export interface BuiltGltf {
  json: Record<string, unknown>;
  bin: Uint8Array;
}

/** A small arm made in the test: a "Hip" bone at the origin, an "Arm" bone one unit above it, a two-quad mesh (the lower quad hangs on the hip, the upper on the arm), and a clip that bends the arm 90 degrees about Z. */
export function buildArm(extra: { animation?: boolean; cubic?: boolean; noSkinWeights?: boolean } = {}): BuiltGltf {
  const chunks: Uint8Array[] = [];
  const views: Array<Record<string, number>> = [];
  const push = (bytes: Uint8Array): number => {
    let offset = 0;
    for (const c of chunks) offset += c.length;
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    chunks.push(padded);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    return views.length - 1;
  };
  const f32 = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
  const positions = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 1, 0, 0.5, 2, 0, -0.5, 2, 0];
  const joints = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const indices = new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]).buffer);
  const ibm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1];
  const accessors: Array<Record<string, unknown>> = [];
  const accessor = (view: number, componentType: number, count: number, type: string): number => {
    accessors.push({ bufferView: view, componentType, count, type });
    return accessors.length - 1;
  };
  const position = accessor(push(f32(positions)), 5126, 8, "VEC3");
  const jointsAcc = accessor(push(joints), 5121, 8, "VEC4");
  const weightsAcc = accessor(push(f32(weights)), 5126, 8, "VEC4");
  const indexAcc = accessor(push(indices), 5123, 12, "SCALAR");
  const ibmAcc = accessor(push(f32(ibm)), 5126, 2, "MAT4");
  const attributes: Record<string, number> = { POSITION: position, JOINTS_0: jointsAcc, WEIGHTS_0: weightsAcc };
  if (extra.noSkinWeights) {
    delete attributes.JOINTS_0;
    delete attributes.WEIGHTS_0;
  }
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [{ name: "Hip", children: [1] }, { name: "Arm", translation: [0, 1, 0] }, { name: "Body", mesh: 0, skin: 0 }],
    meshes: [{ primitives: [{ attributes, indices: indexAcc, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    skins: [{ joints: [0, 1], inverseBindMatrices: ibmAcc }]
  };
  if (extra.animation) {
    const times = accessor(push(f32([0, 1])), 5126, 2, "SCALAR");
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    const values = extra.cubic ? [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, s, c, 0, 0, 0, 0] : [0, 0, 0, 1, 0, 0, s, c];
    const output = accessor(push(f32(values)), 5126, extra.cubic ? 6 : 2, "VEC4");
    json.animations = [{ name: "bend", samplers: [{ input: times, output, interpolation: extra.cubic ? "CUBICSPLINE" : "LINEAR" }], channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }] }];
  }
  json.accessors = accessors;
  json.bufferViews = views;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  json.buffers = [{ byteLength: total }];
  const bin = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.length;
  }
  return { json, bin };
}

export function toGlb(built: BuiltGltf): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(built.json));
  const jsonPadded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  jsonPadded.set(text);
  const out = new Uint8Array(12 + 8 + jsonPadded.length + 8 + built.bin.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  view.setUint32(20 + jsonPadded.length, built.bin.length, true);
  view.setUint32(24 + jsonPadded.length, 0x004e4942, true);
  out.set(built.bin, 28 + jsonPadded.length);
  return out;
}

