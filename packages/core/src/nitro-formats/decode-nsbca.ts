import { BinaryReader, readDictionary } from "./binary-reader";

export interface DecodedNsbcaTrack {
  boneIndex: number;
  /** One entry a frame (`numFrames` of them), real units; absent means this bone's translation stays at its Model bind pose the whole animation. */
  translation?: { x: number; y: number; z: number }[];
  /** One entry a frame, Euler degrees around a single axis (the only rotation this format -- and this project's own encoder -- can represent; see `decodePivotAngle`). */
  rotation?: { x: number; y: number; z: number }[];
  scale?: { x: number; y: number; z: number }[];
}

export interface DecodedNsbca {
  numFrames: number;
  tracks: DecodedNsbcaTrack[];
}

export type DecodeNsbcaResult = { ok: true; animation: DecodedNsbca; warnings: string[] } | { ok: false; errors: string[] };

/**
 * A PivotMatrix's `(form, a, b)` back to a single-axis Euler angle -- the inverse of `nsbca.ts`'s own
 * `encodePivotMatrix`. Forms 0, 4 and 8 (the only ones this project's own encoder ever writes, for the X, Y and Z
 * axes respectively) are inverted exactly, using that encoder's own sign convention (`b = -sin` for Y, `b = sin`
 * for X and Z, matching this project's own `eulerXyzToMatrix3x3`). Any other form (never produced by this
 * converter's own NSBCA output, but possible in a real, third-party file) falls back to treating it as an X-style
 * rotation -- a reasonable guess, not a verified one; see this project's own notes on how uncertain this whole
 * area of the format is.
 */
function decodePivotAngle(form: number, a: number, b: number): { axis: "x" | "y" | "z"; degrees: number } {
  const axis = form === 4 ? "y" : form === 8 ? "z" : "x";
  const sin = axis === "y" ? -b : b;
  return { axis, degrees: (Math.atan2(sin, a) * 180) / Math.PI };
}

const ZERO: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

function axisAngleToVector(axisAngle: { axis: "x" | "y" | "z"; degrees: number }): { x: number; y: number; z: number } {
  return { ...ZERO, [axisAngle.axis]: axisAngle.degrees };
}

/**
 * Decodes an NSBCA (BCA0/JNT0) back to plain per-frame bone tracks -- the inverse of `nsbca.ts`'s own encoder.
 * Reads only the first animation in the file (this project's own encoder, like the overwhelming majority of real
 * NSBCA files, only ever has one). Every curve (constant or sampled) is expanded into a full `numFrames`-long
 * array, the same shape `animationToNsbca`'s own input already uses, so a decoded animation can be fed straight
 * back into an `Animation`'s sparse `AnimationTrack`s (one keyframe a frame; the editor's own curve-thinning can
 * simplify it further if wanted).
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function decodeNsbca(bytes: Uint8Array): DecodeNsbcaResult {
  const r = new BinaryReader(bytes);
  if (r.stamp() !== "BCA0") return { ok: false, errors: ["This isn't an NSBCA file (it doesn't start with \"BCA0\")."] };
  r.u16();
  r.u16();
  r.u32();
  r.u16();
  const numChunks = r.u16();
  const jnt0Off = r.u32();
  if (numChunks < 1) return { ok: false, errors: ["This NSBCA has no animation chunk."] };
  if (new BinaryReader(bytes, jnt0Off).stamp() !== "JNT0") return { ok: false, errors: ["This NSBCA's JNT0 chunk is missing or corrupt."] };

  const warnings: string[] = [];
  const animEntries = readDictionary(bytes, jnt0Off + 8, 4);
  if (animEntries.length === 0) return { ok: false, errors: ["This NSBCA has no animations."] };
  if (animEntries.length > 1) warnings.push(`This NSBCA has ${animEntries.length} animations; only the first ("${animEntries[0].name}") was converted.`);
  const animAt = jnt0Off + animEntries[0].data.u32(); // already relative to the whole JNT0 chunk, per the format's own dictionary-offset convention here (see nsbca.ts's own encode-side comment)

  const ar = new BinaryReader(bytes, animAt);
  ar.u32(); // "J\0AC"
  const numFrames = ar.u16();
  const numTracks = ar.u16();
  ar.u32();
  const pivotDataOff = ar.u32();
  ar.u32(); // basis_matrices_off: never read -- this decoder only understands PivotMatrix-encoded rotations, matching this project's own encoder
  const trackOffsets = Array.from({ length: numTracks }, () => ar.u16());

  const readPivot = (index: number): { axis: "x" | "y" | "z"; degrees: number } => {
    const pr = new BinaryReader(bytes, animAt + pivotDataOff + index * 6);
    const flags = pr.u16();
    const form = flags & 0xf;
    const a = pr.i16() / 4096;
    const b = pr.i16() / 4096;
    return decodePivotAngle(form, a, b);
  };

  const tracks: DecodedNsbcaTrack[] = trackOffsets.map((offset) => {
    const tr = new BinaryReader(bytes, animAt + offset);
    const flags = tr.u16();
    tr.u8();
    const boneIndex = tr.u8();

    const readVectorChannel = (noChannelsBits: number, constantBit: number): { x: number; y: number; z: number }[] | undefined => {
      if (((flags >> noChannelsBits) & 0b11) !== 0) return undefined;
      const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
      const perAxis = axes.map((_, i) => {
        const constant = (flags >> (constantBit + i)) & 1;
        if (constant) {
          const value = tr.fx32();
          return new Array(numFrames).fill(value) as number[];
        }
        tr.u32(); // start/end/width/log_rate word (this decoder always treats a sampled curve as one value a frame, rate 1)
        const samplesOff = tr.u32();
        const sr = new BinaryReader(bytes, animAt + samplesOff);
        return Array.from({ length: numFrames }, () => sr.fx32());
      });
      return Array.from({ length: numFrames }, (_, frame) => ({ x: perAxis[0][frame], y: perAxis[1][frame], z: perAxis[2][frame] }));
    };

    const translation = readVectorChannel(1, 3);
    const noRotation = ((flags >> 6) & 0b11) !== 0;
    let rotation: { x: number; y: number; z: number }[] | undefined;
    if (!noRotation) {
      const constant = (flags >> 8) & 1;
      if (constant) {
        const index = tr.u16() & 0x7fff;
        tr.u16();
        rotation = new Array(numFrames).fill(axisAngleToVector(readPivot(index)));
      } else {
        tr.u32();
        const samplesOff = tr.u32();
        const sr = new BinaryReader(bytes, animAt + samplesOff);
        rotation = Array.from({ length: numFrames }, () => axisAngleToVector(readPivot(sr.u16() & 0x7fff)));
      }
    }
    const scale = readVectorChannel(9, 11);

    return { boneIndex, translation, rotation, scale };
  });

  return { ok: true, animation: { numFrames, tracks }, warnings };
}
