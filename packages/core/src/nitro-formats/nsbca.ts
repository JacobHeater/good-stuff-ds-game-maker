import { BinaryWriter, fx32 } from "./binary-writer";
import { dictionarySize } from "./nitro-dictionary";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface NsbcaTrack {
  boneIndex: number;
  /** One entry a frame (`numFrames` of them); absent to leave this bone's translation at its Model bind pose for the whole animation. */
  translation?: readonly Vector3Like[];
  /** One entry a frame, Euler XYZ degrees. A frame whose rotation turns around more than one axis at once can't be
      represented (see `encodePivotMatrix`'s own doc comment) and is replaced with identity for that one frame, with a warning. */
  rotation?: readonly Vector3Like[];
  scale?: readonly Vector3Like[];
}

export interface NsbcaInput {
  numFrames: number;
  tracks: readonly NsbcaTrack[];
}

const EPSILON = 1e-4;
const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/**
 * Whether a rotation turns around exactly one of the X/Y/Z axes (or none at all): at most one of the three Euler
 * components may be non-zero. Returns that one axis and angle (arbitrary axis, 0 degrees, for the identity case),
 * or null for a real compound rotation (more than one axis at once), which NSBCA's own rotation encoding (see
 * `encodePivotMatrix`) has no way to represent.
 */
function singleAxisAngle(rotation: Vector3Like): { axis: Axis; degrees: number } | null {
  const nonZero = AXES.filter((axis) => !nearlyEqual(rotation[axis], 0));
  if (nonZero.length > 1) return null;
  return { axis: nonZero[0] ?? "x", degrees: nonZero[0] ? rotation[nonZero[0]] : 0 };
}

function toFx16Clamped(value: number): number {
  return Math.round(Math.max(-8, Math.min(8 - 1 / 4096, value)) * 4096);
}

/**
 * A PivotMatrix (nsbmd_docs.txt): 3 u16s encoding a rotation around the X, Y or Z axis as `cos`/`sin` (num(1.3.12),
 * `a`/`b`), with the matrix's other two off-diagonal entries derived from them by sign-flipping, chosen by `form`
 * (which axis) and `neg_c`/`neg_d` (the signs).
 *
 * The exact derivation used here (`c` cross-derived from `b`, `d` cross-derived from `a`: `c = (neg_c?-1:1)*b`,
 * `d = (neg_d?-1:1)*a`) is **not** what nsbmd_docs.txt states verbatim -- it says `c`/`d` are derived from `a`/`b`
 * *themselves* (`c = ±a`, `d = ±b`). That literal reading was checked here against a 90-degree rotation
 * (cos=0, sin=1): it produces a matrix with a whole zero row, which is singular and can never be a rotation. The
 * cross-derived formula used here produces a correct, orthogonal, determinant-1 matrix at every angle this
 * module's own test checks directly (not just byte layout) -- see
 * requirements/compiler/STORY.nitro-native-format-converter.md's Decision section. This is the single most
 * uncertain piece of this whole conversion feature: the correction is mathematically well-motivated, but, like the
 * rest of this format, unverified against real hardware or the official SDK.
 */
function encodePivotMatrix(axis: Axis, degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // `form`/sign choice placing a 2D (cos, sin) rotation into the plane perpendicular to `axis`, matching this
  // project's own Euler-XYZ-degrees-to-matrix convention (`eulerXyzToMatrix3x3` in nsbmd.ts).
  const { form, a, b } = axis === "x" ? { form: 0, a: cos, b: sin } : axis === "y" ? { form: 4, a: cos, b: -sin } : { form: 8, a: cos, b: sin };
  const out = new BinaryWriter();
  out.u16((form & 0xf) | (1 << 5)); // neg_c=1 (c=-b), neg_d=0 (d=+a), neg_one=0 (i=+1) -- the one sign pattern every axis above needs
  out.signed(toFx16Clamped(a), 2);
  out.signed(toFx16Clamped(b), 2);
  return [...out.toBytes()];
}

/** A reusable table of PivotMatrix entries, deduplicating identical (axis, angle) pairs so a mostly-static rig doesn't repeat the same few matrices thousands of times. */
class PivotTable {
  private readonly entries: number[][] = [];
  private readonly indexOf = new Map<string, number>();

  indexFor(axis: Axis, degrees: number): number {
    const key = `${axis}:${Math.round(degrees * 4096)}`;
    const existing = this.indexOf.get(key);
    if (existing !== undefined) return existing;
    const index = this.entries.length;
    this.entries.push(encodePivotMatrix(axis, degrees));
    this.indexOf.set(key, index);
    return index;
  }

  bytes(): number[] {
    return this.entries.flat();
  }
}

/** `RotMatrixIdx`: bit 15 set means `PivotMatrices[index]` (the only array this encoder ever writes to). */
function rotMatrixIdx(index: number): number {
  return (index & 0x7fff) | 0x8000;
}

interface ChannelPlan {
  /** Per-axis (translation/scale) or single (rotation) curve plans, in the order they're written. */
  curves: Array<{ constant: boolean; constantWord: number; samples?: number[] }>;
}

interface TrackPlan {
  track: NsbcaTrack;
  translation: ChannelPlan | null;
  rotation: ChannelPlan | null;
  scale: ChannelPlan | null;
}

function planVectorChannel(values: readonly Vector3Like[] | undefined): ChannelPlan | null {
  if (!values) return null;
  return {
    curves: AXES.map((axis) => {
      const series = values.map((v) => v[axis]);
      const constant = series.every((v) => nearlyEqual(v, series[0]));
      return constant ? { constant: true, constantWord: fx32(series[0]) >>> 0 } : { constant: false, constantWord: 0, samples: series.map((v) => fx32(v) >>> 0) };
    })
  };
}

function planRotationChannel(values: readonly Vector3Like[] | undefined, pivots: PivotTable, warnings: string[], boneIndex: number): ChannelPlan | null {
  if (!values) return null;
  let badFrames = 0;
  const axisAngles = values.map((v) => {
    const result = singleAxisAngle(v);
    if (result === null) badFrames++;
    return result ?? { axis: "x" as const, degrees: 0 };
  });
  if (badFrames > 0) {
    warnings.push(`Bone ${boneIndex}'s rotation turns around more than one axis at once on ${badFrames} frame${badFrames === 1 ? "" : "s"}; only a single-axis turn can be exported, so ${badFrames === 1 ? "that frame was" : "those frames were"} replaced with no rotation.`);
  }
  const first = axisAngles[0];
  const constant = axisAngles.every((aa) => aa.axis === first.axis && nearlyEqual(aa.degrees, first.degrees));
  if (constant) {
    return { curves: [{ constant: true, constantWord: rotMatrixIdx(pivots.indexFor(first.axis, first.degrees)) }] };
  }
  return { curves: [{ constant: false, constantWord: 0, samples: axisAngles.map((aa) => rotMatrixIdx(pivots.indexFor(aa.axis, aa.degrees))) }] };
}

/** Each curve in a plan is 4 bytes of its own (a constant value, or a sampled curve's start/end/width/rate word); every non-constant curve also needs a `samples_off` field right after those 4 bytes. */
function curveOwnSize(curve: { constant: boolean }): number {
  return curve.constant ? 4 : 8;
}

function trackHeaderAndCurvesSize(plan: TrackPlan): number {
  const channels = [plan.translation, plan.rotation, plan.scale].filter((c): c is ChannelPlan => c !== null);
  const curveBytes = channels.reduce((sum, channel) => sum + channel.curves.reduce((s, c) => s + curveOwnSize(c), 0), 0);
  return 4 + curveBytes; // flags(2) + dummy(1) + target_index(1), then the curves
}

function trackFlags(plan: TrackPlan): number {
  let flags = 0;
  if (!plan.translation) flags |= 0b11 << 1;
  else plan.translation.curves.forEach((c, i) => c.constant && (flags |= 1 << (3 + i)));
  if (!plan.rotation) flags |= 0b11 << 6;
  else if (plan.rotation.curves[0].constant) flags |= 1 << 8;
  if (!plan.scale) flags |= 0b11 << 9;
  else plan.scale.curves.forEach((c, i) => c.constant && (flags |= 1 << (11 + i)));
  return flags;
}

/**
 * Converts a set of per-bone keyframe tracks (already sampled at a fixed frame rate -- see the Converter's own
 * resampling of this project's sparse `AnimationTrack`s) into an NSBCA (BCA0/JNT0) -- the real Nintendo DS skeletal
 * animation format a paired NSBMD's bones are animated with. See requirements/compiler/STORY.nitro-native-format-
 * converter.md for the scoping decisions (rigid bones, no weighted skinning) this and `nsbmd.ts` share, and
 * `encodePivotMatrix`'s own doc comment for the one genuinely uncertain part: rotation encoding.
 */
export function encodeNsbca(input: NsbcaInput): { bytes: Uint8Array; warnings: string[] } {
  const { numFrames, tracks } = input;
  const warnings: string[] = [];
  const pivots = new PivotTable();

  const plans: TrackPlan[] = tracks.map((track) => ({
    track,
    translation: planVectorChannel(track.translation),
    rotation: planRotationChannel(track.rotation, pivots, warnings, track.boneIndex),
    scale: planVectorChannel(track.scale)
  }));

  // ---- Layout: fixed Animation header, then track_offs[], then each track's own bytes, then every sampled curve's own samples, then the shared PivotMatrices table. ----
  const animHeaderSize = 4 + 2 + 2 + 4 + 4 + 4; // stamp(4) + num_frames(2) + num_tracks(2) + unknown(4) + pivot_data_off(4) + basis_matrices_off(4)
  const trackOffsAt = animHeaderSize;
  let cursor = trackOffsAt + 2 * tracks.length;
  const trackStart = plans.map((plan) => {
    const at = cursor;
    cursor += trackHeaderAndCurvesSize(plan);
    return at;
  });
  const samplesStart = cursor;
  let sampleCursor = samplesStart;
  const sampleOffsetFor: number[][] = plans.map((plan) => {
    const offsets: number[] = [];
    // A translation/scale sample is a num(1.19.12) (4 bytes); a rotation sample is a RotMatrixIdx (nsbmd_docs.txt: a
    // plain u16), not the same width -- this must match the per-sample write size in the two loops below exactly.
    for (const [channel, sampleBytes] of [[plan.translation, 4], [plan.rotation, 2], [plan.scale, 4]] as const) {
      if (!channel) continue;
      for (const curve of channel.curves) {
        if (curve.constant) continue;
        offsets.push(sampleCursor);
        sampleCursor += (curve.samples?.length ?? 0) * sampleBytes;
      }
    }
    return offsets;
  });
  const pivotDataOff = sampleCursor;

  const animation = new BinaryWriter();
  animation.bytes_([0x4a, 0x00, 0x41, 0x43]); // "J\0AC" per nsbmd_docs.txt
  animation.u16(numFrames);
  animation.u16(tracks.length);
  animation.u32(0);
  animation.u32(pivotDataOff);
  animation.u32(0); // basis_matrices_off: always empty (BasisMatrix is never used here -- see encodePivotMatrix's own doc comment)
  for (const at of trackStart) animation.u16(at);

  for (const [planIndex, plan] of plans.entries()) {
    animation.u16(trackFlags(plan));
    animation.u8(0); // dummy
    animation.u8(plan.track.boneIndex);
    let sampleIndex = 0;
    const offsets = sampleOffsetFor[planIndex];
    for (const channel of [plan.translation, plan.rotation, plan.scale]) {
      if (!channel) continue;
      for (const curve of channel.curves) {
        if (curve.constant) {
          animation.u32(curve.constantWord);
        } else {
          const count = curve.samples?.length ?? 0;
          animation.u32((count & 0xffff) << 16); // start_frame=0, end_frame=count, width=0, log_rate=0
          animation.u32(offsets[sampleIndex++]);
        }
      }
    }
  }

  for (const plan of plans) {
    for (const [channel, isRotation] of [[plan.translation, false], [plan.rotation, true], [plan.scale, false]] as const) {
      if (!channel) continue;
      for (const curve of channel.curves) {
        if (curve.constant || !curve.samples) continue;
        for (const sample of curve.samples) (isRotation ? animation.u16(sample) : animation.u32(sample));
      }
    }
  }

  animation.bytes_(pivots.bytes());
  const animationBytes = [...animation.toBytes()];

  // ---- JNT0: a NameList(u32) with one entry, "Animation", pointing at the Animation above. ----
  const jntDictSize = dictionarySize(1, 4);
  const jnt0 = new BinaryWriter();
  jnt0.bytes_([0x4a, 0x4e, 0x54, 0x30]); // "JNT0"
  const jnt0SizeAt = jnt0.placeholder(4);
  jnt0.u8(0);
  jnt0.u8(1);
  jnt0.u16(jntDictSize);
  jnt0.u16(8);
  jnt0.u16(12);
  jnt0.u32(0x17f);
  jnt0.u32(0);
  jnt0.u16(4);
  jnt0.u16(20);
  jnt0.u32(8 + jntDictSize); // relative to this JNT chunk (stamp + filesize, 8 bytes, before this dictionary)
  jnt0.name16("Animation");
  jnt0.bytes_(animationBytes);
  jnt0.patchU32(jnt0SizeAt, jnt0.length);
  const jnt0Bytes = jnt0.toBytes();

  const containerHeaderSize = 16 + 4;
  const out = new BinaryWriter();
  out.bytes_([0x42, 0x43, 0x41, 0x30]); // "BCA0"
  out.u16(0xfeff);
  out.u16(2);
  out.u32(containerHeaderSize + jnt0Bytes.length);
  out.u16(16);
  out.u16(1);
  out.u32(containerHeaderSize);
  out.bytes_(jnt0Bytes);

  return { bytes: out.toBytes(), warnings };
}
