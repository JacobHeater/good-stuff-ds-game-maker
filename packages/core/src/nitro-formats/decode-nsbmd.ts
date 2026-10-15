import { BinaryReader, readDictionary } from "./binary-reader";
import { bytesToWords, decodeVertexStream, unpackGxCommands } from "./decode-gx-commands";

export interface DecodedBone {
  name: string;
  /** Index into this model's own `bones`, or -1 for a root (no bone computes its own matrix from this one). */
  parentIndex: number;
  position: { x: number; y: number; z: number };
  /** Column-major 3x3 rotation matrix, 9 entries: [m00,m10,m20, m01,m11,m21, m02,m12,m22]. */
  rotation: number[];
  scale: { x: number; y: number; z: number };
}

export interface DecodedNsbmdMesh {
  boneIndex: number;
  materialIndex: number;
  /** x, y, z per unique vertex, in the assigned bone's own local space (real units). */
  positions: number[];
  uvs?: number[];
  indices: number[];
}

export interface DecodedNsbmd {
  bones: DecodedBone[];
  meshes: DecodedNsbmdMesh[];
  materialNames: string[];
}

export type DecodeNsbmdResult = { ok: true; model: DecodedNsbmd; warnings: string[] } | { ok: false; errors: string[] };

const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Decodes a BoneMatrix (nsbmd_docs.txt) -- the inverse of `nsbmd.ts`'s `encodeBoneMatrix`, but reads every documented
    form (explicit matrix, PivotMatrix, and the all-defaults case), not just the one this project's own encoder writes,
    for better compatibility with a real NSBMD. */
function decodeBoneMatrix(r: BinaryReader): { position: { x: number; y: number; z: number }; rotation: number[]; scale: { x: number; y: number; z: number } } {
  const flags = r.u16();
  const t = flags & 1;
  const rm = (flags >> 1) & 1;
  const s = (flags >> 2) & 1;
  const rp = (flags >> 3) & 1;
  const form = (flags >> 4) & 0xf;
  const negOne = (flags >> 8) & 1;
  const negC = (flags >> 9) & 1;
  const negD = (flags >> 10) & 1;
  const m0 = r.fx16();

  const position = t === 0 ? { x: r.fx32(), y: r.fx32(), z: r.fx32() } : { x: 0, y: 0, z: 0 };

  let rotation = IDENTITY_3X3;
  if (rp === 1) {
    const a = r.fx16();
    const b = r.fx16();
    rotation = decodePivotForm(form, negOne, negC, negD, a, b);
  } else if (rm === 0) {
    const ms = Array.from({ length: 8 }, () => r.fx16());
    // [ m0 ms[2] ms[5] ; ms[0] ms[3] ms[6] ; ms[1] ms[4] ms[7] ], converted here to this module's own column-major layout.
    rotation = [m0, ms[0], ms[1], ms[2], ms[3], ms[4], ms[5], ms[6], ms[7]];
  }

  const scale = s === 0 ? { x: r.fx32(), y: r.fx32(), z: r.fx32() } : { x: 1, y: 1, z: 1 };
  return { position, rotation, scale };
}

/** The same 9-form table `nsbca.ts`'s `encodePivotMatrix` uses, and the same cross-derivation (`c` from `b`, `d` from `a`) -- see that file's own doc comment for why. Returns the matrix in this module's column-major layout. */
function decodePivotForm(form: number, negOne: number, negC: number, negD: number, a: number, b: number): number[] {
  const i = negOne ? -1 : 1;
  const c = (negC ? -1 : 1) * b;
  const d = (negD ? -1 : 1) * a;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // row-major scratch, converted to column-major at the end
  const set = (row: number, col: number, v: number): void => {
    m[row * 3 + col] = v;
  };
  // Hand-derived, cell by cell, from nsbmd_docs.txt's own 9-form ASCII diagram -- cross-checked against
  // `nsbca.ts`'s `encodePivotMatrix`, which independently derived (and tested, via orthogonality/determinant
  // checks) forms 0, 4 and 8 for its own X/Y/Z-axis encoding; this table's forms 0, 4 and 8 match it exactly.
  const layouts: Record<number, Array<[number, number, number]>> = {
    0: [[0, 0, i], [1, 1, a], [1, 2, c], [2, 1, b], [2, 2, d]],
    1: [[1, 0, i], [0, 1, a], [0, 2, c], [2, 1, b], [2, 2, d]],
    2: [[2, 0, i], [0, 1, a], [0, 2, c], [1, 1, b], [1, 2, d]],
    3: [[0, 1, i], [1, 0, a], [1, 2, c], [2, 0, b], [2, 2, d]],
    4: [[1, 1, i], [0, 0, a], [0, 2, c], [2, 0, b], [2, 2, d]],
    5: [[2, 1, i], [0, 0, a], [0, 2, c], [1, 0, b], [1, 2, d]],
    6: [[0, 2, i], [1, 0, a], [1, 1, c], [2, 0, b], [2, 1, d]],
    7: [[1, 2, i], [0, 0, a], [0, 1, c], [2, 0, b], [2, 1, d]],
    8: [[2, 2, i], [0, 0, a], [0, 1, c], [1, 0, b], [1, 1, d]]
  };
  for (const [row, col, v] of layouts[form] ?? layouts[0]) set(row, col, v);
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; // row-major -> column-major
}

/**
 * Decodes an NSBMD (BMD0/MDL0) back to plain bones and meshes -- the inverse of `nsbmd.ts`'s own encoder. Reads
 * only the first model in the file (this project's own encoder, and the overwhelming majority of real NSBMD files,
 * only ever have one); a second model, if present, is ignored with a warning.
 *
 * Bone parentage is read directly from each bone-multiply command's own `parent_idx` parameter (self-referencing,
 * i.e. equal to that command's own `bone_idx`, marks a root), not reconstructed from the matrix-stack load/store
 * slots. An earlier version of this decoder did the opposite, on the strength of nsbmd_docs.txt's own claim that
 * `parent_idx` "I don't think it's used at all at runtime" -- but a real downloaded NSBMD showed that claim doesn't
 * mean the field is unreliable, only that hardware rendering doesn't need it: that file's stack-slot reconstruction
 * produced nonsense (every non-root bone's "load" slot was still unwritten when its command ran), while `parent_idx`
 * gave the exact, sensible skeleton. This project's own encoder (`nsbmd.ts`) already writes `parent_idx` this same
 * way (a bone's real parent, or its own index for a root), so trusting it directly works for both.
 *
 * The matrix stack is still tracked, but only to resolve which bone a Draw Mesh command is bound to: a bare "Load
 * Matrix from Stack" command (0x03) switches the "current" bone to whichever bone last stored into that slot, which
 * real files use to draw a second mesh against an earlier bone without re-walking the multiply chain -- a pattern
 * this project's own encoder never emits (it draws each mesh immediately after its own bone), so it never surfaced
 * in self-round-trip testing until a real file exposed it.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function decodeNsbmd(bytes: Uint8Array): DecodeNsbmdResult {
  const r = new BinaryReader(bytes);
  if (r.stamp() !== "BMD0") return { ok: false, errors: ["This isn't an NSBMD file (it doesn't start with \"BMD0\")."] };
  r.u16();
  r.u16();
  r.u32();
  r.u16();
  const numChunks = r.u16();
  const mdl0Off = r.u32();
  if (numChunks < 1) return { ok: false, errors: ["This NSBMD has no model chunk."] };
  if (new BinaryReader(bytes, mdl0Off).stamp() !== "MDL0") return { ok: false, errors: ["This NSBMD's MDL0 chunk is missing or corrupt."] };

  const warnings: string[] = [];
  const modelEntries = readDictionary(bytes, mdl0Off + 8, 4);
  if (modelEntries.length === 0) return { ok: false, errors: ["This NSBMD has no models."] };
  if (modelEntries.length > 1) warnings.push(`This NSBMD has ${modelEntries.length} models; only the first ("${modelEntries[0].name}") was converted.`);
  const modelAt = mdl0Off + modelEntries[0].data.u32();

  const model = new BinaryReader(bytes, modelAt);
  model.u32(); // filesize
  const renderCmdsOff = model.u32();
  const materialsOff = model.u32();
  const meshesOff = model.u32();
  model.u32(); // inv_binds_off (never read: this decoder never needs the weighted-skinning matrices)
  model.u8();
  model.u8();
  model.u8();
  model.u8(); // num_bone_matrices
  const numMaterials = model.u8();
  model.u8(); // num_meshes

  const boneListAt = modelAt + 0x40;
  const boneEntries = readDictionary(bytes, boneListAt, 4);
  const bones: DecodedBone[] = boneEntries.map((entry) => {
    const at = boneListAt + entry.data.u32();
    const decoded = decodeBoneMatrix(new BinaryReader(bytes, at));
    return { name: entry.name, parentIndex: -1, ...decoded };
  });

  const meshListAt = modelAt + meshesOff;
  const meshEntries = readDictionary(bytes, meshListAt, 4);
  const meshStreams = meshEntries.map((entry) => {
    const at = meshListAt + entry.data.u32();
    const mr = new BinaryReader(bytes, at);
    mr.u16();
    mr.u16();
    mr.u32();
    const cmdsOff = mr.u32();
    const cmdsLen = mr.u32();
    const cmdBytes = bytes.slice(at + cmdsOff, at + cmdsOff + cmdsLen);
    return decodeVertexStream(unpackGxCommands(bytesToWords(cmdBytes)));
  });

  let materialNames: string[] = [];
  try {
    const materialListAt = modelAt + materialsOff;
    // MaterialList { texture_pairings_off, palette_pairings_off, NameList(u32) }: nsbmd_docs.txt's own struct shows
    // the materials NameList(u32) written inline right after the 4-byte header, which is what a real downloaded
    // NSBMD actually does -- but this project's own encoder (`nsbmd.ts`) instead always places it after both
    // pairing dictionaries (which are always present, even empty, so that's offset 4+16+16=36 at minimum, never 4).
    // `numMaterials` (from the Model header) says which layout this particular file actually used.
    const paletteOff = new BinaryReader(bytes, materialListAt + 2).u16();
    const paletteDictSize = readDictionarySize(bytes, materialListAt + paletteOff);
    const afterPairingsAt = materialListAt + paletteOff + paletteDictSize;
    const inlineAt = materialListAt + 4;
    const materialsDictAt = new BinaryReader(bytes, inlineAt + 1).u8() === numMaterials ? inlineAt : afterPairingsAt;
    materialNames = readDictionary(bytes, materialsDictAt, 4).map((e) => e.name);
  } catch {
    warnings.push("This NSBMD's material names couldn't be read; materials were numbered instead.");
  }

  // Interpret the render command list to find each mesh's bound bone (the bone whose matrix was "current" when it
  // was drawn -- tracked via the matrix stack, since a real file can switch "current" back to an earlier bone with
  // a bare stack load) and each bone's real parent (that bone's own multiply command's `parent_idx` parameter).
  const stackSlotOwner = new Map<number, number>();
  let currentBone = -1;
  let currentMaterial = 0;
  const meshBone: number[] = new Array(meshEntries.length).fill(0);
  const meshMaterial: number[] = new Array(meshEntries.length).fill(0);
  const rc = new BinaryReader(bytes, modelAt + renderCmdsOff);
  let guard = 0;
  while (guard++ < 100000) {
    const opcode = rc.u8();
    if (opcode === 0x01) break; // End
    if (opcode === 0x00 || opcode === 0x40 || opcode === 0x80) continue; // Nop
    if (opcode === 0x03) {
      const slot = rc.u8(); // Load Matrix from Stack: switches "current" to whichever bone last stored into this slot
      currentBone = stackSlotOwner.get(slot) ?? currentBone;
      continue;
    }
    if (opcode === 0x04 || opcode === 0x24 || opcode === 0x44) {
      currentMaterial = rc.u8();
      continue;
    }
    if (opcode === 0x05) {
      const meshIndex = rc.u8();
      if (meshIndex < meshBone.length) {
        meshBone[meshIndex] = currentBone;
        meshMaterial[meshIndex] = currentMaterial;
      }
      continue;
    }
    if (opcode === 0x06 || opcode === 0x26 || opcode === 0x46 || opcode === 0x66) {
      const boneIdx = rc.u8();
      const parentIdx = rc.u8();
      rc.u8(); // unknown
      if (opcode & 0x40) rc.u8(); // load slot: irrelevant here, since bone_idx itself names the bone this multiply produces
      currentBone = boneIdx;
      if (bones[boneIdx]) bones[boneIdx].parentIndex = parentIdx === boneIdx ? -1 : parentIdx;
      if (opcode & 0x20) stackSlotOwner.set(rc.u8(), boneIdx);
      continue;
    }
    if (opcode === 0x09) {
      rc.u8(); // store_index
      const numTerms = rc.u8();
      rc.pos += numTerms * 3; // each term is 3 parameters; this decoder doesn't support weighted skinning, so these are skipped
      continue;
    }
    if (opcode === 0x0b || opcode === 0x2b) continue; // Scale Up/Down: doesn't affect bone/mesh association
    if (opcode === 0x02 || (opcode & 0x1f) === 0x0c || (opcode & 0x1f) === 0x0d) {
      rc.pos += 2;
      continue;
    }
    if (opcode === 0x07) {
      rc.u8();
      continue;
    }
    if (opcode === 0x47) {
      rc.pos += 2;
      continue;
    }
    if (opcode === 0x08) {
      rc.u8();
      continue;
    }
    // An opcode this decoder doesn't recognize: stop rather than misread the rest of the list.
    break;
  }

  const meshes: DecodedNsbmdMesh[] = meshStreams.map((stream, i) => ({
    boneIndex: meshBone[i],
    materialIndex: meshMaterial[i],
    positions: stream.positions,
    uvs: stream.uvs,
    indices: stream.indices
  }));

  return { ok: true, model: { bones, meshes, materialNames }, warnings };
}

/** The total byte size of the dictionary at `at` (its own `size` field) -- used only to skip past the (possibly empty) texture/palette pairing dictionaries to find where the materials' own `NameList(u32)` begins. */
function readDictionarySize(bytes: Uint8Array, at: number): number {
  return new BinaryReader(bytes, at + 2).u16();
}
