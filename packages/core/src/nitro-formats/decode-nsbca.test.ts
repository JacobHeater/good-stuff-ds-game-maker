import { describe, expect, it } from "vitest";

import { decodeNsbca } from "./decode-nsbca";
import { encodeNsbca, type NsbcaTrack, type Vector3Like } from "./nsbca";

function v(x: number, y: number, z: number): Vector3Like {
  return { x, y, z };
}

describe("decodeNsbca", () => {
  it("round-trips a constant translation track exactly", () => {
    const track: NsbcaTrack = { boneIndex: 2, translation: [v(1, 2, 3), v(1, 2, 3), v(1, 2, 3)] };
    const { bytes } = encodeNsbca({ numFrames: 3, tracks: [track] });
    const decoded = decodeNsbca(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.animation.numFrames).toBe(3);
    expect(decoded.animation.tracks).toHaveLength(1);
    const t = decoded.animation.tracks[0];
    expect(t.boneIndex).toBe(2);
    expect(t.translation).toHaveLength(3);
    for (const frame of t.translation!) {
      expect(frame.x).toBeCloseTo(1);
      expect(frame.y).toBeCloseTo(2);
      expect(frame.z).toBeCloseTo(3);
    }
    expect(t.rotation).toBeUndefined();
    expect(t.scale).toBeUndefined();
  });

  it("round-trips a sampled translation track's exact per-frame values", () => {
    const frames = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0)];
    const track: NsbcaTrack = { boneIndex: 0, translation: frames };
    const { bytes } = encodeNsbca({ numFrames: 4, tracks: [track] });
    const decoded = decodeNsbca(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    decoded.animation.tracks[0].translation!.forEach((frame, i) => expect(frame.x).toBeCloseTo(i));
  });

  it("round-trips a constant single-axis rotation to the same angle on the same axis", () => {
    for (const [axis, index] of [["x", 0], ["y", 1], ["z", 2]] as const) {
      const rotation = axis === "x" ? v(37, 0, 0) : axis === "y" ? v(0, -52, 0) : v(0, 0, 90);
      const track: NsbcaTrack = { boneIndex: 0, rotation: [rotation, rotation] };
      const { bytes, warnings } = encodeNsbca({ numFrames: 2, tracks: [track] });
      expect(warnings).toEqual([]);
      const decoded = decodeNsbca(bytes);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const decodedRotation = decoded.animation.tracks[0].rotation![0];
      const decodedAngle = [decodedRotation.x, decodedRotation.y, decodedRotation.z][index];
      const expectedAngle = [rotation.x, rotation.y, rotation.z][index];
      expect(decodedAngle).toBeCloseTo(expectedAngle, 0);
    }
  });

  it("round-trips a sampled rotation across frames, reusing the same angle's PivotMatrix entry", () => {
    const track: NsbcaTrack = { boneIndex: 0, rotation: [v(0, 0, 0), v(45, 0, 0), v(90, 0, 0)] };
    const { bytes } = encodeNsbca({ numFrames: 3, tracks: [track] });
    const decoded = decodeNsbca(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const rotation = decoded.animation.tracks[0].rotation!;
    expect(rotation[0].x).toBeCloseTo(0, 0);
    expect(rotation[1].x).toBeCloseTo(45, 0);
    expect(rotation[2].x).toBeCloseTo(90, 0);
  });

  it("leaves an un-animated channel absent, matching the encoder's no-channel flags", () => {
    const track: NsbcaTrack = { boneIndex: 0 };
    const { bytes } = encodeNsbca({ numFrames: 1, tracks: [track] });
    const decoded = decodeNsbca(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const t = decoded.animation.tracks[0];
    expect(t.translation).toBeUndefined();
    expect(t.rotation).toBeUndefined();
    expect(t.scale).toBeUndefined();
  });

  it("round-trips scale", () => {
    const track: NsbcaTrack = { boneIndex: 0, scale: [v(2, 1, 0.5), v(2, 1, 0.5)] };
    const { bytes } = encodeNsbca({ numFrames: 2, tracks: [track] });
    const decoded = decodeNsbca(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.animation.tracks[0].scale![0].x).toBeCloseTo(2);
    expect(decoded.animation.tracks[0].scale![0].z).toBeCloseTo(0.5);
  });

  it("refuses a file that isn't an NSBCA", () => {
    const result = decodeNsbca(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
  });
});
