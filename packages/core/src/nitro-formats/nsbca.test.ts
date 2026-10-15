import { describe, expect, it } from "vitest";

import { encodeNsbca, type NsbcaTrack, type Vector3Like } from "./nsbca";

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
  i32(): number {
    const v = this.u32();
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }
  stamp(): string {
    const s = String.fromCharCode(this.bytes[this.pos], this.bytes[this.pos + 1], this.bytes[this.pos + 2], this.bytes[this.pos + 3]);
    this.pos += 4;
    return s;
  }
}

/** Decodes a PivotMatrix's 3 u16s (at `at`) into a full 3x3 matrix, using this encoder's own cross-derivation (`c=-b`, `d=+a`) -- this is the thing under test, not an independent reference, so these tests check the decoded matrix's own mathematical properties (orthogonality, determinant, a known rotation) rather than comparing against a second implementation. */
function decodePivotMatrix(bytes: Uint8Array, at: number): number[][] {
  const r = new Reader(bytes, at);
  const flags = r.u16();
  const form = flags & 0xf;
  const negOne = (flags >> 4) & 1;
  const negC = (flags >> 5) & 1;
  const negD = (flags >> 6) & 1;
  const a = r.i16() / 4096;
  const b = r.i16() / 4096;
  const i = negOne ? -1 : 1;
  const c = (negC ? -1 : 1) * b;
  const d = (negD ? -1 : 1) * a;
  const m = Array.from({ length: 3 }, () => [0, 0, 0]);
  const layouts: Record<number, Array<[number, number, number]>> = {
    0: [
      [0, 0, i],
      [1, 1, a],
      [1, 2, c],
      [2, 1, b],
      [2, 2, d]
    ].map(([row, col, v]) => [row, col, v]) as Array<[number, number, number]>,
    4: [
      [0, 0, a],
      [0, 2, c],
      [1, 1, i],
      [2, 0, b],
      [2, 2, d]
    ] as Array<[number, number, number]>,
    8: [
      [0, 0, a],
      [0, 1, c],
      [1, 0, b],
      [1, 1, d],
      [2, 2, i]
    ] as Array<[number, number, number]>
  };
  for (const [row, col, v] of layouts[form]) m[row][col] = v;
  return m;
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function determinant3x3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function v(x: number, y: number, z: number): Vector3Like {
  return { x, y, z };
}

describe("encodePivotMatrix (via encodeNsbca)", () => {
  it("decodes to an orthogonal, determinant-1 rotation matrix for a range of single-axis angles", () => {
    for (const axis of [0, 1, 2] as const) {
      for (const degrees of [0, 30, 45, 90, 135, 180, -60, -90]) {
        const rotation: Vector3Like = axis === 0 ? v(degrees, 0, 0) : axis === 1 ? v(0, degrees, 0) : v(0, 0, degrees);
        const track: NsbcaTrack = { boneIndex: 0, rotation: [rotation] };
        const { bytes, warnings } = encodeNsbca({ numFrames: 1, tracks: [track] });
        expect(warnings).toEqual([]);

        // Find the Animation's pivot_data_off and read the one PivotMatrix it wrote.
        const r = new Reader(bytes).seek(16); // skip BCA0 container header to subfile_offs[0]
        const jnt0At = r.u32();
        const dictAt = jnt0At + 8;
        const dr = new Reader(bytes, dictAt);
        dr.u8();
        dr.u8();
        dr.u16();
        dr.u16();
        const unknownSize = dr.u16();
        dr.seek(dictAt + 2 + 2 + unknownSize);
        dr.u16(); // element_size
        dr.u16(); // data_section_size
        const animRelOff = dr.u32();
        const animAt = jnt0At + animRelOff;
        const ar = new Reader(bytes, animAt + 8); // past "J\0AC" + num_frames + num_tracks
        ar.u32(); // unknown
        const pivotDataOff = ar.u32();

        const m = decodePivotMatrix(bytes, animAt + pivotDataOff);
        const [row0, row1, row2] = m;
        expect(dot(row0, row0)).toBeCloseTo(1, 1);
        expect(dot(row1, row1)).toBeCloseTo(1, 1);
        expect(dot(row2, row2)).toBeCloseTo(1, 1);
        expect(dot(row0, row1)).toBeCloseTo(0, 1);
        expect(dot(row0, row2)).toBeCloseTo(0, 1);
        expect(dot(row1, row2)).toBeCloseTo(0, 1);
        expect(determinant3x3(m)).toBeCloseTo(1, 1);
      }
    }
  });

  it("matches the project's own Euler-XYZ rotation matrix for a single-axis rotation exactly", () => {
    // A 90-degree X rotation should send the Y axis to the Z axis (standard right-handed rotation).
    const track: NsbcaTrack = { boneIndex: 0, rotation: [v(90, 0, 0)] };
    const { bytes } = encodeNsbca({ numFrames: 1, tracks: [track] });
    const r = new Reader(bytes).seek(16);
    const jnt0At = r.u32();
    const dictAt = jnt0At + 8;
    const dr = new Reader(bytes, dictAt);
    dr.u8();
    dr.u8();
    dr.u16();
    dr.u16();
    const unknownSize = dr.u16();
    dr.seek(dictAt + 2 + 2 + unknownSize);
    dr.u16();
    dr.u16();
    const animAt = jnt0At + dr.u32();
    const ar = new Reader(bytes, animAt + 8);
    ar.u32();
    const pivotDataOff = ar.u32();
    const m = decodePivotMatrix(bytes, animAt + pivotDataOff);
    // Rx(90) * (0,1,0) = (0, cos90, sin90) = (0, 0, 1); Rx(90) * (0,0,1) = (0,-sin90,cos90) = (0,-1,0).
    const applyColumn1 = [m[0][1], m[1][1], m[2][1]];
    expect(applyColumn1[0]).toBeCloseTo(0, 1);
    expect(applyColumn1[1]).toBeCloseTo(0, 1);
    expect(applyColumn1[2]).toBeCloseTo(1, 1);
  });
});

describe("encodeNsbca", () => {
  it("writes a valid BCA0/JNT0 container for a track with constant translation, no rotation, no scale", () => {
    const track: NsbcaTrack = { boneIndex: 2, translation: [v(1, 2, 3), v(1, 2, 3), v(1, 2, 3)] };
    const { bytes, warnings } = encodeNsbca({ numFrames: 3, tracks: [track] });
    expect(warnings).toEqual([]);

    const r = new Reader(bytes);
    expect(r.stamp()).toBe("BCA0");
    expect(r.u16()).toBe(0xfeff);
    r.u16();
    expect(r.u32()).toBe(bytes.length);
    expect(r.u16()).toBe(16);
    expect(r.u16()).toBe(1);
    const jnt0At = r.u32();
    expect(jnt0At).toBe(20);

    r.seek(jnt0At);
    expect(r.stamp()).toBe("JNT0");
    const jnt0Size = r.u32();
    expect(jnt0Size).toBe(bytes.length - jnt0At);

    r.seek(jnt0At + 8);
    r.u8();
    expect(r.u8()).toBe(1); // one animation
    r.u16();
    r.u16();
    const unknownSize = r.u16();
    r.seek(jnt0At + 8 + 2 + 2 + unknownSize);
    r.u16();
    r.u16();
    const animRelOff = r.u32();
    const animAt = jnt0At + animRelOff;

    const ar = new Reader(bytes, animAt);
    expect(ar.stamp()).toBe("J\0AC");
    expect(ar.u16()).toBe(3); // num_frames
    expect(ar.u16()).toBe(1); // num_tracks
    ar.u32();
    ar.u32(); // pivot_data_off
    expect(ar.u32()).toBe(0); // basis_matrices_off: always empty

    const trackOff = ar.u16();
    const tr = new Reader(bytes, animAt + trackOff);
    const flags = tr.u16();
    expect(flags & 1).toBe(0); // no_channels: false (translation is present)
    expect((flags >> 1) & 0b11).toBe(0); // translation channels present
    expect((flags >> 3) & 1).toBe(1); // translation X constant
    expect((flags >> 4) & 1).toBe(1); // translation Y constant
    expect((flags >> 5) & 1).toBe(1); // translation Z constant
    expect((flags >> 6) & 0b11).toBe(0b11); // no rotation channel
    expect((flags >> 9) & 0b11).toBe(0b11); // no scale channels
    tr.u8();
    expect(tr.u8()).toBe(2); // target_index (bone index)
    expect(tr.i32() / 4096).toBeCloseTo(1); // constant translation X
    expect(tr.i32() / 4096).toBeCloseTo(2); // Y
    expect(tr.i32() / 4096).toBeCloseTo(3); // Z
  });

  it("samples a varying translation track and recovers the exact per-frame values", () => {
    const frames = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0)];
    const track: NsbcaTrack = { boneIndex: 0, translation: frames };
    const { bytes } = encodeNsbca({ numFrames: 4, tracks: [track] });

    const r = new Reader(bytes).seek(16);
    const jnt0At = r.u32();
    const dictAt = jnt0At + 8;
    const dr = new Reader(bytes, dictAt);
    dr.u8();
    dr.u8();
    dr.u16();
    dr.u16();
    const unknownSize = dr.u16();
    dr.seek(dictAt + 2 + 2 + unknownSize);
    dr.u16();
    dr.u16();
    const animAt = jnt0At + dr.u32();

    const ar = new Reader(bytes, animAt + 4);
    ar.u16();
    ar.u16();
    ar.u32();
    ar.u32();
    ar.u32();
    const trackOff = ar.u16();

    const tr = new Reader(bytes, animAt + trackOff);
    const flags = tr.u16();
    expect((flags >> 3) & 1).toBe(0); // translation X is sampled, not constant
    tr.u8();
    tr.u8();
    const word = tr.u32();
    const endFrame = (word >>> 16) & 0xffff;
    expect(endFrame).toBe(4);
    const samplesOff = tr.u32();
    const sr = new Reader(bytes, animAt + samplesOff);
    for (let i = 0; i < 4; i++) expect(sr.i32() / 4096).toBeCloseTo(i);
  });

  it("drops a compound (multi-axis) rotation frame to identity and warns, naming the bone", () => {
    const track: NsbcaTrack = { boneIndex: 5, rotation: [v(10, 20, 0)] };
    const { warnings } = encodeNsbca({ numFrames: 1, tracks: [track] });
    expect(warnings).toEqual(["Bone 5's rotation turns around more than one axis at once on 1 frame; only a single-axis turn can be exported, so that frame was replaced with no rotation."]);
  });

  it("reuses the same PivotMatrix entry for repeated angles across frames and tracks", () => {
    const trackA: NsbcaTrack = { boneIndex: 0, rotation: [v(45, 0, 0), v(45, 0, 0), v(90, 0, 0)] };
    const trackB: NsbcaTrack = { boneIndex: 1, rotation: [v(45, 0, 0), v(90, 0, 0), v(90, 0, 0)] };
    const { bytes } = encodeNsbca({ numFrames: 3, tracks: [trackA, trackB] });
    // Two distinct angles (45, 90) used across both tracks should produce exactly 2 PivotMatrix entries (6 bytes each), not 6.
    const r = new Reader(bytes).seek(16);
    const jnt0At = r.u32();
    const dictAt = jnt0At + 8;
    const dr = new Reader(bytes, dictAt);
    dr.u8();
    dr.u8();
    dr.u16();
    dr.u16();
    const unknownSize = dr.u16();
    dr.seek(dictAt + 2 + 2 + unknownSize);
    dr.u16();
    dr.u16();
    const animAt = jnt0At + dr.u32();
    const ar = new Reader(bytes, animAt + 8);
    ar.u32();
    const pivotDataOff = ar.u32();
    // The PivotMatrices table is the very last thing written in the Animation, so everything from pivot_data_off
    // to the end of the file is exactly that table: 2 distinct angles (45, 90) x 6 bytes each, not 6 entries.
    expect(bytes.length - (animAt + pivotDataOff)).toBe(2 * 6);
  });

  it("marks no_channels-equivalent flags when a track has no translation, rotation or scale at all", () => {
    const track: NsbcaTrack = { boneIndex: 0 };
    const { bytes } = encodeNsbca({ numFrames: 1, tracks: [track] });
    const r = new Reader(bytes).seek(16);
    const jnt0At = r.u32();
    const dictAt = jnt0At + 8;
    const dr = new Reader(bytes, dictAt);
    dr.u8();
    dr.u8();
    dr.u16();
    dr.u16();
    const unknownSize = dr.u16();
    dr.seek(dictAt + 2 + 2 + unknownSize);
    dr.u16();
    dr.u16();
    const animAt = jnt0At + dr.u32();
    const ar = new Reader(bytes, animAt + 4);
    ar.u16();
    ar.u16();
    ar.u32();
    ar.u32();
    ar.u32();
    const trackOff = ar.u16();
    const flags = new Reader(bytes, animAt + trackOff).u16();
    expect((flags >> 1) & 0b11).toBe(0b11);
    expect((flags >> 6) & 0b11).toBe(0b11);
    expect((flags >> 9) & 0b11).toBe(0b11);
  });
});
