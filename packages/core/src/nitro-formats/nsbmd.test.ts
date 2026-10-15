import { describe, expect, it } from "vitest";

import { encodeNsbmd, type NsbmdBone, type NsbmdMaterial, type NsbmdMesh } from "./nsbmd";

/** A minimal reader for this test file's own structural walk (not a general NSBMD parser). */
class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    public pos = 0
  ) {}
  seek(pos: number): this {
    this.pos = pos;
    return this;
  }
  u8(): number {
    return this.bytes[this.pos++];
  }
  u16(): number {
    const v = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    const v = (this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8) | (this.bytes[this.pos + 2] << 16) | (this.bytes[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  stamp(): string {
    const s = String.fromCharCode(this.bytes[this.pos], this.bytes[this.pos + 1], this.bytes[this.pos + 2], this.bytes[this.pos + 3]);
    this.pos += 4;
    return s;
  }
  name16(): string {
    const chars: number[] = [];
    for (let i = 0; i < 16; i++) {
      const c = this.u8();
      if (c !== 0) chars.push(c);
    }
    return String.fromCharCode(...chars);
  }
}

/** Reads a generic Nitro dictionary at `at`, returning each entry's name and its own `elementSize` bytes of data (as a sub-Reader positioned at the start of that data). */
function readDictionary(bytes: Uint8Array, at: number, elementSize: number): Array<{ name: string; data: Reader }> {
  const r = new Reader(bytes, at);
  r.u8(); // dummy
  const count = r.u8();
  r.u16(); // size
  r.u16(); // unknown subheader size
  const unknownSize = r.u16();
  r.seek(at + 2 + 2 + unknownSize); // skip past dummy/count/size/Unknown to the element_size field
  const readElementSize = r.u16();
  expect(readElementSize).toBe(elementSize);
  r.u16(); // data_section_size
  const dataStart = r.pos;
  const entries: Array<{ name: string; data: Reader }> = [];
  for (let i = 0; i < count; i++) entries.push({ name: "", data: new Reader(bytes, dataStart + i * elementSize) });
  const namesStart = dataStart + count * elementSize;
  for (let i = 0; i < count; i++) entries[i].name = new Reader(bytes, namesStart + i * 16).name16();
  return entries;
}

function cube(name: string, boneIndex: number, materialIndex: number): NsbmdMesh {
  const positions = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];
  void name;
  return { boneIndex, materialIndex, positions, indices };
}

describe("encodeNsbmd", () => {
  it("writes a valid BMD0/MDL0 container whose header fields and counts match a single-bone model", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const meshes: NsbmdMesh[] = [cube("Body", 0, 0)];
    const { bytes, warnings } = encodeNsbmd({ bones, materials, meshes });
    expect(warnings).toEqual([]);

    const r = new Reader(bytes);
    expect(r.stamp()).toBe("BMD0");
    expect(r.u16()).toBe(0xfeff);
    r.u16();
    expect(r.u32()).toBe(bytes.length);
    expect(r.u16()).toBe(16);
    expect(r.u16()).toBe(1);
    const mdl0Off = r.u32();
    expect(mdl0Off).toBe(20);

    r.seek(mdl0Off);
    expect(r.stamp()).toBe("MDL0");
    const mdl0Size = r.u32();
    expect(mdl0Size).toBe(bytes.length - mdl0Off);

    // MDL0's own models dictionary: one entry, "model", offset relative to MDL0 (= mdl0Off-relative, matching the "relative to this MDL" offset semantics).
    const modelsDictAt = mdl0Off + 8;
    const [modelEntry] = readDictionary(bytes, modelsDictAt, 4);
    expect(modelEntry.name).toBe("model");
    const modelRelOffset = modelEntry.data.u32();
    const modelAt = mdl0Off + modelRelOffset;

    const model = new Reader(bytes, modelAt);
    const filesize = model.u32();
    expect(filesize).toBe(mdl0Off + mdl0Size - modelAt);
    const renderCmdsOff = model.u32();
    const materialsOff = model.u32();
    const meshesOff = model.u32();
    const invBindsOff = model.u32();
    model.u8();
    model.u8();
    model.u8();
    expect(model.u8()).toBe(1); // num_bone_matrices
    expect(model.u8()).toBe(1); // num_materials
    expect(model.u8()).toBe(1); // num_meshes
    model.u16();
    expect(model.u32()).toBe(0x1000); // up_scale: 1.0 (no scaling needed, this cube fits +/-8 directly)
    expect(model.u32()).toBe(0x1000); // down_scale
    expect(model.u16()).toBe(8); // num_verts
    expect(model.u16()).toBe(4); // num_polys (4 triangles)
    expect(model.u16()).toBe(4); // num_tris

    // BoneList starts right after the 64-byte header, self-relative offsets.
    const boneListAt = modelAt + 0x40;
    const [boneEntry] = readDictionary(bytes, boneListAt, 4);
    expect(boneEntry.name).toBe("Root");
    const boneAt = boneListAt + boneEntry.data.u32();
    const boneFlags = new Reader(bytes, boneAt).u16();
    expect(boneFlags).toBe(0); // t=0, rm=0, s=0, rp=0: an explicit translation, raw rotation matrix, and explicit scale all follow

    // MeshList, MaterialList and the render command list / InvBindMatrices sit at the offsets the Model header named.
    const meshListAt = modelAt + meshesOff;
    const [meshEntry] = readDictionary(bytes, meshListAt, 4);
    const meshAt = meshListAt + meshEntry.data.u32();
    const meshReader = new Reader(bytes, meshAt);
    meshReader.u16();
    expect(meshReader.u16()).toBe(16); // size
    meshReader.u32();
    const cmdsOff = meshReader.u32();
    const cmdsLen = meshReader.u32();
    expect(cmdsOff).toBe(16);
    expect(cmdsLen % 4).toBe(0); // GX commands are packed as whole u32 words

    // The mesh's own GX command blob starts with a BEGIN_VTXS (opcode 0x40) in the low byte of its first packed word.
    const gx = new Reader(bytes, meshAt + cmdsOff);
    const firstWord = gx.u32();
    expect(firstWord & 0xff).toBe(0x40);

    const materialListAt = modelAt + materialsOff;
    const texPairOff = new Reader(bytes, materialListAt).u16();
    const paletteOff = new Reader(bytes, materialListAt + 2).u16();
    expect(texPairOff).toBe(4);
    expect(paletteOff).toBe(4 + 16); // no textured materials, so the texture pairing dictionary has 0 entries -- but a dictionary's own fixed header is still 16 bytes
    // The palette pairing dictionary is likewise empty-but-present (also 16 bytes), so the material names dictionary follows right after both.
    const [materialNameEntry] = readDictionary(bytes, materialListAt + paletteOff + 16, 4);
    expect(materialNameEntry.name).toBe("Mat");

    expect(invBindsOff).toBeGreaterThan(0);
    expect(renderCmdsOff).toBe(invBindsOff); // no InvBindMatrices written (this converter never uses the weighted-skinning command)

    // Render command list: a single root bone (0x26: multiply by its own matrix, store to slot 0, no load), then bind material 0 and draw mesh 0, then End (0x01).
    const render = new Reader(bytes, modelAt + renderCmdsOff);
    expect(render.u8()).toBe(0x26);
    expect(render.u8()).toBe(0); // bone_idx
    expect(render.u8()).toBe(0); // parent_idx (root points at itself; "not used at runtime" per nsbmd_docs.txt)
    expect(render.u8()).toBe(0); // unknown
    expect(render.u8()).toBe(0); // store slot
    expect(render.u8()).toBe(0x04); // Bind Material
    expect(render.u8()).toBe(0); // material index
    expect(render.u8()).toBe(0x05); // Draw Mesh
    expect(render.u8()).toBe(0); // mesh index
    expect(render.u8()).toBe(0x01); // End
  });

  it("walks a two-bone parent/child tree with the child loading the parent's stored matrix", () => {
    const bones: NsbmdBone[] = [
      { name: "Hip", parentIndex: -1, position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { name: "Leg", parentIndex: 0, position: { x: 0, y: -1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
    ];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const meshes: NsbmdMesh[] = [cube("HipMesh", 0, 0), cube("LegMesh", 1, 0)];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const r = new Reader(bytes);
    r.stamp();
    r.u16();
    r.u16();
    r.u32();
    r.u16();
    r.u16();
    const mdl0Off = r.u32();
    const [modelEntry] = readDictionary(bytes, mdl0Off + 8, 4);
    const modelAt = mdl0Off + modelEntry.data.u32();
    const model = new Reader(bytes, modelAt);
    model.u32();
    const renderCmdsOff = model.u32();

    const render = new Reader(bytes, modelAt + renderCmdsOff);
    // Hip (root): 0x26, bone 0, parent 0 (self), unknown 0, store slot 0.
    expect([render.u8(), render.u8(), render.u8(), render.u8(), render.u8()]).toEqual([0x26, 0, 0, 0, 0]);
    expect([render.u8(), render.u8(), render.u8(), render.u8()]).toEqual([0x04, 0, 0x05, 0]); // bind + draw HipMesh
    // Leg (child of Hip, slot 0): 0x66, bone 1, parent 0, unknown 0, load slot 0, store slot 1.
    expect([render.u8(), render.u8(), render.u8(), render.u8(), render.u8(), render.u8()]).toEqual([0x66, 1, 0, 0, 0, 1]);
    expect([render.u8(), render.u8(), render.u8(), render.u8()]).toEqual([0x04, 0, 0x05, 1]); // bind + draw LegMesh
    expect(render.u8()).toBe(0x01);
  });

  it("scales a model whose vertices exceed the +/-8 unit range down to fit, and warns", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat" }];
    const big: NsbmdMesh = { boneIndex: 0, materialIndex: 0, positions: cube("Big", 0, 0).positions.map((v) => v * 100), indices: cube("Big", 0, 0).indices };
    const { bytes, warnings } = encodeNsbmd({ bones, materials, meshes: [big] });
    expect(warnings.some((w) => w.includes("scaled down"))).toBe(true);

    const r = new Reader(bytes);
    r.stamp();
    r.u16();
    r.u16();
    r.u32();
    r.u16();
    r.u16();
    const mdl0Off = r.u32();
    const [modelEntry] = readDictionary(bytes, mdl0Off + 8, 4);
    const modelAt = mdl0Off + modelEntry.data.u32();
    const model = new Reader(bytes, modelAt);
    model.seek(modelAt + 28);
    const upScale = model.u32();
    expect(upScale).toBeGreaterThan(0x1000); // scaled up by more than 1x to compensate for the pre-shrunk vertex data

    // The render command list includes a Scale Up (0x0b) before drawing the only mesh.
    model.seek(modelAt);
    model.u32();
    const renderCmdsOff = model.u32();
    const render = new Reader(bytes, modelAt + renderCmdsOff);
    render.seek(render.pos + 5); // past the root bone's multiply+store command
    expect(render.u8()).toBe(0x0b); // Scale Up
  });

  it("names a paired texture correctly in the texture pairing list, relative to the Material's own node", () => {
    const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
    const materials: NsbmdMaterial[] = [{ name: "Mat", textureName: "Wall", textureWidth: 32, textureHeight: 32 }];
    const meshes: NsbmdMesh[] = [cube("Body", 0, 0)];
    const { bytes } = encodeNsbmd({ bones, materials, meshes });

    const r = new Reader(bytes);
    r.stamp();
    r.u16();
    r.u16();
    r.u32();
    r.u16();
    r.u16();
    const mdl0Off = r.u32();
    const [modelEntry] = readDictionary(bytes, mdl0Off + 8, 4);
    const modelAt = mdl0Off + modelEntry.data.u32();
    const model = new Reader(bytes, modelAt);
    model.u32();
    model.u32();
    const materialsOff = model.u32();
    const materialListAt = modelAt + materialsOff;
    const texPairOff = new Reader(bytes, materialListAt).u16();
    const [pairingEntry] = readDictionary(bytes, materialListAt + texPairOff, 4);
    expect(pairingEntry.name).toBe("Wall");
    const entryStructAt = pairingEntry.data.pos;
    const selfRelativeOffset = pairingEntry.data.u16();
    const count = pairingEntry.data.u8();
    expect(count).toBe(1);
    const indicesAt = entryStructAt + selfRelativeOffset;
    expect(new Reader(bytes, indicesAt).u8()).toBe(0); // the one material index using this texture: "Mat", index 0
  });
});
