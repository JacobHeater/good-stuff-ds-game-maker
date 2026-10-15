import { BinaryWriter, fx16, fx32 } from "./binary-writer";
import { beginVtxs, endVtxs, packGxCommands, texcoord, vtx16, type GxCommand } from "./gx-commands";
import { dictionarySize, writeDictionary, type DictionaryEntry } from "./nitro-dictionary";

/** A bone's local-to-parent transform (TRS), in this project's own Euler-XYZ-degrees convention (`reference-render.ts`'s `group.rotation.set(x*DEG, y*DEG, z*DEG, "XYZ")`). */
export interface NsbmdBone {
  name: string;
  /** Index into the model's own `bones` array, or -1 for the root. Must come before any bone that names it as a parent. */
  parentIndex: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface NsbmdMaterial {
  name: string;
  /** A paired texture/palette Name (from an NSBTX this model's own TEX0, or an external one a game loads separately), or absent for an untextured, flat-colored material. */
  textureName?: string;
  textureWidth?: number;
  textureHeight?: number;
}

export interface NsbmdMesh {
  /** Which bone's matrix these vertices are rigidly drawn with -- this converter never emits the weighted multi-bone skinning command (see STORY.nitro-native-format-converter.md's Decision section: the DS's own geometry engine has no hardware skinning, so a rigid per-mesh bone assignment is both simpler and how this project's own glTF rig importer already works). */
  boneIndex: number;
  materialIndex: number;
  /** x, y, z per unique vertex, in the assigned bone's own local space. */
  positions: readonly number[];
  /** u, v per unique vertex, image space (v top-to-bottom) -- only meaningful when `materials[materialIndex].textureName` is set. */
  uvs?: readonly number[];
  /** Three vertex indices per triangle. */
  indices: readonly number[];
}

export interface NsbmdInput {
  bones: readonly NsbmdBone[];
  materials: readonly NsbmdMaterial[];
  meshes: readonly NsbmdMesh[];
}

const VERTEX_LIMIT = 8 - 1 / 4096; // VTX_16 is num(1.3.12): 1 sign + 3 integer + 12 fraction bits, range +/-8

function eulerXyzToMatrix3x3(xDeg: number, yDeg: number, zDeg: number): number[] {
  const d = Math.PI / 180;
  const [sx, cx] = [Math.sin(xDeg * d), Math.cos(xDeg * d)];
  const [sy, cy] = [Math.sin(yDeg * d), Math.cos(yDeg * d)];
  const [sz, cz] = [Math.sin(zDeg * d), Math.cos(zDeg * d)];
  // R = Rx * Ry * Rz (intrinsic X, then Y, then Z -- this project's own Euler convention, see reference-render.ts).
  return [
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy
  ];
}

/** A BoneMatrix: the local-to-parent TRS transform (nsbmd_docs.txt). Always writes an explicit translation and scale and the
    full 3x3 rotation matrix (the `rm=0`, non-pivot form) -- the only rotation encoding fully, unambiguously documented;
    the alternative `BasisMatrix`/`PivotMatrix` forms used for *animated* rotation curves are not used here, since a bind
    pose can always be stored as a plain matrix. */
function encodeBoneMatrix(bone: NsbmdBone): number[] {
  const m = eulerXyzToMatrix3x3(bone.rotation.x, bone.rotation.y, bone.rotation.z);
  const out = new BinaryWriter();
  out.u16(0); // t=0 (translation present), rm=0 (raw matrix), s=0 (scale present), rp=0, form/neg bits unused, ignored bits 0
  out.signed(fx16(m[0]), 2); // m0 (stored here for alignment, per the format)
  out.signed(fx32(bone.position.x), 4);
  out.signed(fx32(bone.position.y), 4);
  out.signed(fx32(bone.position.z), 4);
  // ms[0..7] = m1..m8 (m0 already written above)
  for (const value of m.slice(1)) out.signed(fx16(value), 2);
  out.signed(fx32(bone.scale.x), 4);
  out.signed(fx32(bone.scale.y), 4);
  out.signed(fx32(bone.scale.z), 4);
  return [...out.toBytes()];
}

/** One Mesh's GX command blob: a flat triangle list, each vertex given a texture coordinate first (if the mesh has UVs) then its position. No material/lighting commands here -- those are the bound Material's job (DIF_AMB sets a flat white vertex color once per bind, so an untextured mesh still renders at full brightness without needing a NORMAL command or a lighting setup). */
function encodeMeshCommands(mesh: NsbmdMesh, scale: number): { bytes: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const commands: GxCommand[] = [beginVtxs(0)];
  const positions = mesh.positions;
  const uvs = mesh.uvs;
  let outOfRange = 0;
  for (const index of mesh.indices) {
    const x = (positions[index * 3] ?? 0) / scale;
    const y = (positions[index * 3 + 1] ?? 0) / scale;
    const z = (positions[index * 3 + 2] ?? 0) / scale;
    if (Math.abs(x) > VERTEX_LIMIT || Math.abs(y) > VERTEX_LIMIT || Math.abs(z) > VERTEX_LIMIT) outOfRange++;
    if (uvs) commands.push(texcoord(uvs[index * 2] ?? 0, uvs[index * 2 + 1] ?? 0));
    commands.push(vtx16(fx16(x), fx16(y), fx16(z)));
  }
  commands.push(endVtxs());
  if (outOfRange > 0) warnings.push(`${outOfRange} vertex position${outOfRange === 1 ? "" : "s"} didn't fit the DS's +/-8 unit range even after scaling, and were clamped.`);
  const words = packGxCommands(commands);
  const out = new BinaryWriter();
  for (const word of words) out.u32(word);
  return { bytes: [...out.toBytes()], warnings };
}

/** A Material: flat-white vertex color (DIF_AMB.bit15), optionally textured. No lighting, no specular/emission -- a plain, always-visible, modulated-by-texture-or-white material, matching the "convert the geometry, not a lighting rig" scope of this converter. */
function encodeMaterial(material: NsbmdMaterial): number[] {
  const out = new BinaryWriter();
  out.u16(0); // dummy
  out.u16(0x2c); // size
  out.u32(0x8000 | 31 | (31 << 16)); // DIF_AMB: bit15 set (use as vertex color), diffuse white; ambient 0
  out.u32(0); // SPE_EMI: no specular, no emission
  out.u32(((1 << 6) | (1 << 7)) >>> 0); // POLYGON_ATTR: render both front and back faces, modulation mode, no lights
  out.u32(0); // unknown (possibly SHININESS parameter; unused)
  const hasTexture = material.textureName !== undefined;
  out.u32(0); // teximage_params (this converter's own half is always 0: no repeat/mirror/transform; the paired Texture's half, if any, supplies the format/size/offset bits)
  out.u32(0xffffffff);
  out.u32(0x1fce0000);
  out.u16(hasTexture ? (material.textureWidth ?? 0) : 0);
  out.u16(hasTexture ? (material.textureHeight ?? 0) : 0);
  out.u32(0x1000);
  out.u32(0x1000);
  return [...out.toBytes()];
}

/**
 * A dictionary whose entries are offsets (`u32`) to data placed right after the dictionary itself -- the pattern
 * `BoneList`/`MeshList`/the plain-offset part of `MaterialList` all use. `blobs[i]` is entry `i`'s own bytes.
 *
 * `baseOffset` is how far the dictionary's own first byte sits from whatever anchor the format says these offsets
 * are "relative to" -- 0 when that anchor *is* the dictionary itself (BoneList, MeshList), or a small fixed header
 * size when the format instead means "relative to the chunk the dictionary lives in" (MDL0's own `models` list is
 * documented as relative to the whole MDL chunk, which starts 8 bytes before the dictionary; MaterialList's own
 * `NameList(u32)` of Materials is relative to the whole MaterialList, which starts 4 bytes before it).
 */
function offsetDictionary(names: readonly string[], blobs: readonly (readonly number[])[], baseOffset = 0): number[] {
  const dictSize = dictionarySize(names.length, 4);
  let cursor = dictSize;
  const entries: DictionaryEntry[] = names.map((name, i) => {
    const offset = baseOffset + cursor;
    cursor += blobs[i].length;
    return { name, data: [...u32bytes(offset)] };
  });
  const out = new BinaryWriter();
  writeDictionary(out, entries, 4);
  for (const blob of blobs) out.bytes_(blob);
  return [...out.toBytes()];
}

/**
 * A `NameList(MaterialIdxList)` (TexturePairingList/PalettePairingList): unlike `offsetDictionary`, each entry's 4
 * bytes (`offset`, `count`, `dummy`) sit directly inline in the dictionary's own data section (the documented
 * element type *is* MaterialIdxList, not a pointer to one) -- only each entry's own trailing `u8[count]` index
 * array is placed after the dictionary, pointed to by that entry's own `offset` field, which the format says is
 * itself relative to that one entry's 4 bytes (not the dictionary, not the list of indices as a whole).
 */
function materialIdxListDictionary(names: readonly string[], indexLists: readonly (readonly number[])[]): number[] {
  const count = names.length;
  const dictSize = dictionarySize(count, 4);
  const entryPos = (i: number): number => 16 + 4 * count + i * 4; // where entry i's own inline 4 bytes sit within the dictionary
  let trailingCursor = dictSize;
  const trailingStart: number[] = [];
  for (const indices of indexLists) {
    trailingStart.push(trailingCursor);
    trailingCursor += indices.length;
  }
  const entries: DictionaryEntry[] = names.map((name, i) => {
    const selfRelativeOffset = trailingStart[i] - entryPos(i);
    return { name, data: [selfRelativeOffset & 0xff, (selfRelativeOffset >>> 8) & 0xff, indexLists[i].length, 0] };
  });
  const out = new BinaryWriter();
  writeDictionary(out, entries, 4);
  for (const indices of indexLists) out.bytes_(indices);
  return [...out.toBytes()];
}

function u32bytes(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/**
 * Converts a rigid (possibly multi-bone) model into an NSBMD (BMD0/MDL0) -- the real Nintendo DS model format the
 * official Nitro SDK's own model pipeline produces, readable by any NSBMD-aware tool, not a format invented for
 * this project. See requirements/compiler/STORY.nitro-native-format-converter.md for the format research this is
 * built from (nsbmd_docs.txt, GBATEK, and libnds's own GX register headers, cross-checked against each other) and
 * the scoping decisions below.
 *
 * Every mesh is rigidly attached to one bone (no weighted multi-bone vertex skinning -- the DS geometry engine has
 * no hardware skinning, so this matches how real, simple NSBMD-based games already do it, and how this project's
 * own glTF importer already assigns triangles to bones). The RenderCommandList is a straightforward depth-first
 * walk of the bone tree: compute each bone's world matrix from its parent's (one matrix-stack slot per bone),
 * then bind and draw whatever meshes are rigidly attached to it.
 *
 * Vertex positions must fit the hardware's own +/-8 unit range (VTX_16 is 1.3.12 fixed point); if the input
 * doesn't, every mesh is uniformly scaled down to fit, and the RenderCommandList compensates with a Scale Up
 * command before drawing, so the final geometry still comes out at its real size.
 */
export function encodeNsbmd(input: NsbmdInput): { bytes: Uint8Array; warnings: string[] } {
  const { bones, materials, meshes } = input;
  const warnings: string[] = [];

  let maxAbs = 0;
  for (const mesh of meshes) for (const value of mesh.positions) maxAbs = Math.max(maxAbs, Math.abs(value));
  const scale = maxAbs > VERTEX_LIMIT ? maxAbs / 7.5 : 1;
  if (scale !== 1) warnings.push(`This model is bigger than the DS geometry engine's vertex range, so it was scaled down by ${scale.toFixed(3)}x in the file (and scaled back up when drawn, via the Model's Scale Up command) to fit.`);

  // ---- Bones ----
  const boneBlobs = bones.map(encodeBoneMatrix);
  const boneListBytes = offsetDictionary(bones.map((b) => b.name), boneBlobs);

  // ---- Meshes ----
  const meshCommandBlobs = meshes.map((mesh) => {
    const { bytes, warnings: meshWarnings } = encodeMeshCommands(mesh, scale);
    warnings.push(...meshWarnings);
    return bytes;
  });
  const meshBlobs = meshCommandBlobs.map((cmdBytes) => {
    const out = new BinaryWriter();
    out.u16(0); // dummy
    out.u16(16); // size
    out.u32(0); // unknown
    out.u32(16); // cmds_off, relative to this Mesh (right after this 16-byte header)
    out.u32(cmdBytes.length);
    out.bytes_(cmdBytes);
    return [...out.toBytes()];
  });
  const meshListBytes = offsetDictionary(meshes.map((_, i) => `mesh${i}`), meshBlobs);

  // ---- Materials (with texture/palette pairing, grouped by shared texture Name) ----
  const materialBlobs = materials.map(encodeMaterial);
  const texturedByName = new Map<string, number[]>();
  materials.forEach((material, i) => {
    if (material.textureName === undefined) return;
    const list = texturedByName.get(material.textureName) ?? [];
    list.push(i);
    texturedByName.set(material.textureName, list);
  });
  const pairingList = (): number[] => {
    const names = [...texturedByName.keys()];
    const indexLists = names.map((name) => texturedByName.get(name)!);
    return materialIdxListDictionary(names, indexLists);
  };
  // Always a well-formed dictionary (possibly with zero entries), never skipped -- a palette is always paired 1:1 with a
  // texture of the same Name in this converter's own simple model, so both lists share exactly the same grouping.
  const texturePairings = pairingList();
  const palettePairings = pairingList();
  const materialNameListBytes = offsetDictionary(
    materials.map((m) => m.name),
    materialBlobs,
    4 // MaterialList's own u32 offsets are relative to the whole MaterialList chunk, which starts 4 bytes (texture_pairings_off + palette_pairings_off) before this dictionary
  );
  const materialList = new BinaryWriter();
  materialList.u16(4); // texture_pairings_off, relative to this MaterialList (right after its own 4-byte header)
  materialList.u16(4 + texturePairings.length); // palette_pairings_off
  materialList.bytes_(texturePairings);
  materialList.bytes_(palettePairings);
  materialList.bytes_(materialNameListBytes);
  const materialListBytes = [...materialList.toBytes()];

  // ---- Render command list: depth-first walk of the bone tree ----
  const children = bones.map(() => [] as number[]);
  bones.forEach((bone, i) => {
    if (bone.parentIndex >= 0) children[bone.parentIndex].push(i);
  });
  const roots = bones.map((_, i) => i).filter((i) => bones[i].parentIndex < 0);
  const stackSlotOf = new Map<number, number>();
  let nextSlot = 0;
  const renderBytes: number[] = [];
  const push = (...values: number[]): void => {
    renderBytes.push(...values);
  };
  const meshesByBone = new Map<number, number[]>();
  meshes.forEach((mesh, i) => {
    const list = meshesByBone.get(mesh.boneIndex) ?? [];
    list.push(i);
    meshesByBone.set(mesh.boneIndex, list);
  });
  const visit = (boneIndex: number): void => {
    const slot = nextSlot++;
    stackSlotOf.set(boneIndex, slot);
    const bone = bones[boneIndex];
    if (bone.parentIndex < 0) {
      push(0x26, boneIndex, boneIndex, 0, slot); // multiply by this bone's matrix and store (no load: current matrix is the object's own base transform)
    } else {
      const parentSlot = stackSlotOf.get(bone.parentIndex)!;
      push(0x66, boneIndex, bone.parentIndex, 0, parentSlot, slot); // load parent, multiply, store
    }
    const ownMeshes = meshesByBone.get(boneIndex) ?? [];
    if (ownMeshes.length > 0 && scale !== 1) push(0x0b); // Scale Up (only affects "current", not the clean value already stored to this bone's slot)
    for (const meshIndex of ownMeshes) {
      push(0x04, meshes[meshIndex].materialIndex);
      push(0x05, meshIndex);
    }
    for (const child of children[boneIndex]) visit(child);
  };
  for (const root of roots) visit(root);
  push(0x01); // End

  // ---- Bounding box (approximate: the combined vertex extent, clamped to the format's own 1.3.12 range) ----
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i] / scale);
      maxX = Math.max(maxX, mesh.positions[i] / scale);
      minY = Math.min(minY, mesh.positions[i + 1] / scale);
      maxY = Math.max(maxY, mesh.positions[i + 1] / scale);
      minZ = Math.min(minZ, mesh.positions[i + 2] / scale);
      maxZ = Math.max(maxZ, mesh.positions[i + 2] / scale);
    }
  }
  const safe = (v: number): number => (Number.isFinite(v) ? v : 0);

  // ---- Model header + assembly ----
  const headerSize = 0x40;
  const boneListOff = headerSize;
  const meshListOff = boneListOff + boneListBytes.length;
  const materialListOff = meshListOff + meshListBytes.length;
  const invBindsOff = materialListOff + materialListBytes.length; // points at a valid, empty location: this converter never emits the weighted-skinning command that would need it
  const renderCmdsOff = invBindsOff; // render commands follow immediately (InvBindMatrices has zero entries, zero bytes)

  const model = new BinaryWriter();
  const filesizeAt = model.placeholder(4);
  model.u32(renderCmdsOff);
  model.u32(materialListOff);
  model.u32(meshListOff);
  model.u32(invBindsOff);
  model.u8(0);
  model.u8(0);
  model.u8(0);
  model.u8(bones.length);
  model.u8(materials.length);
  model.u8(meshes.length);
  model.u16(0);
  model.u32(fx32(scale));
  model.u32(fx32(1 / scale));
  const numVerts = meshes.reduce((sum, m) => sum + m.positions.length / 3, 0);
  const numTris = meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);
  model.u16(Math.min(0xffff, numVerts));
  model.u16(Math.min(0xffff, numTris));
  model.u16(Math.min(0xffff, numTris));
  model.u16(0);
  model.signed(fx16(safe(minX)), 2);
  model.signed(fx16(safe(minY)), 2);
  model.signed(fx16(safe(minZ)), 2);
  model.signed(fx16(safe(maxX - minX)), 2);
  model.signed(fx16(safe(maxY - minY)), 2);
  model.signed(fx16(safe(maxZ - minZ)), 2);
  for (let i = 0; i < 8; i++) model.u8(0);
  model.bytes_(boneListBytes);
  model.bytes_(meshListBytes);
  model.bytes_(materialListBytes);
  model.bytes_(renderBytes);
  model.patchU32(filesizeAt, model.length);
  const modelBytes = [...model.toBytes()];

  const mdl0 = new BinaryWriter();
  mdl0.bytes_([0x4d, 0x44, 0x4c, 0x30]); // "MDL0"
  const mdl0SizeAt = mdl0.placeholder(4);
  mdl0.bytes_(offsetDictionary(["model"], [modelBytes], 8)); // relative to the whole MDL chunk (stamp + filesize, 8 bytes, before this dictionary)
  mdl0.patchU32(mdl0SizeAt, mdl0.length);
  const mdl0Bytes = mdl0.toBytes();

  const containerHeaderSize = 16 + 4; // Header (16) + one subfile offset (no TEX0: this converter keeps model and texture files separate)
  const out = new BinaryWriter();
  out.bytes_([0x42, 0x4d, 0x44, 0x30]); // "BMD0"
  out.u16(0xfeff);
  out.u16(2);
  out.u32(containerHeaderSize + mdl0Bytes.length);
  out.u16(16);
  out.u16(1);
  out.u32(containerHeaderSize);
  out.bytes_(mdl0Bytes);

  return { bytes: out.toBytes(), warnings };
}
