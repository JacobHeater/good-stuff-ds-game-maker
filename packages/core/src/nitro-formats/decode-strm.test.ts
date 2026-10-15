import { describe, expect, it } from "vitest";

import { encodeImaAdpcm } from "../ima-adpcm";
import { decodeStrm } from "./decode-strm";
import { encodeStrm } from "./strm";
import { writeWav } from "./write-wav";

describe("decodeStrm", () => {
  it("round-trips PCM16 samples exactly through encodeStrm", () => {
    const original = new Int16Array([0, 100, -100, 32767, -32768, 1234]);
    const bytes = new Uint8Array(original.length * 2);
    const view = new DataView(bytes.buffer);
    original.forEach((s, i) => view.setInt16(i * 2, s, true));
    const encoded = encodeStrm({ sampleRate: 16000, channels: [bytes], format: "pcm16", sampleCount: original.length });
    const decoded = decodeStrm(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.strm.sampleRate).toBe(16000);
    expect([...decoded.strm.channels[0]]).toEqual([...original]);
  });

  it("round-trips IMA-ADPCM samples through decodeImaAdpcm/encodeImaAdpcm (lossy, but close)", () => {
    // A smooth, slowly-varying signal, same style as ima-adpcm.test.ts's own round-trip test -- ADPCM's adaptive
    // step size needs several samples to catch up to a fast-changing signal, so a signal that changes this slowly
    // relative to its sample count is what "close" means for this lossy codec, not any arbitrary short waveform.
    const n = 200;
    const original = new Int16Array(n);
    for (let i = 0; i < n; i++) original[i] = Math.round(Math.sin(i * ((Math.PI * 10) / 2000)) * 10000); // same per-sample angular rate as ima-adpcm.test.ts's own proven round-trip
    const encodedAdpcm = encodeImaAdpcm(original);
    const strm = encodeStrm({ sampleRate: 11025, channels: [encodedAdpcm], format: "ima-adpcm", sampleCount: n });
    const decoded = decodeStrm(strm);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.strm.channels[0]).toHaveLength(n);
    for (let i = 0; i < n; i++) expect(Math.abs(decoded.strm.channels[0][i] - original[i])).toBeLessThan(2000);
  });

  it("decodes stereo channels separately", () => {
    const left = new Int16Array([1, 2, 3]);
    const right = new Int16Array([4, 5, 6]);
    const toBytes = (s: Int16Array): Uint8Array => {
      const b = new Uint8Array(s.length * 2);
      new DataView(b.buffer).setInt16(0, s[0], true);
      new DataView(b.buffer).setInt16(2, s[1], true);
      new DataView(b.buffer).setInt16(4, s[2], true);
      return b;
    };
    const encoded = encodeStrm({ sampleRate: 22050, channels: [toBytes(left), toBytes(right)], format: "pcm16", sampleCount: 3 });
    const decoded = decodeStrm(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect([...decoded.strm.channels[0]]).toEqual([1, 2, 3]);
    expect([...decoded.strm.channels[1]]).toEqual([4, 5, 6]);
  });

  it("refuses a file that isn't an STRM", () => {
    const result = decodeStrm(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
  });
});

describe("writeWav", () => {
  it("writes a valid RIFF/WAVE header with the right data size", () => {
    const samples = new Int16Array([1, -1, 1000, -1000]);
    const bytes = writeWav(22050, [samples]);
    const text = String.fromCharCode(...bytes.slice(0, 4));
    expect(text).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe("fmt ");
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(22050); // sample rate
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(String.fromCharCode(...bytes.slice(36, 40))).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(bytes.length).toBe(44 + samples.length * 2);
  });

  it("interleaves stereo channels", () => {
    const bytes = writeWav(16000, [new Int16Array([1, 2]), new Int16Array([10, 20])]);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(1);
    expect(view.getInt16(46, true)).toBe(10);
    expect(view.getInt16(48, true)).toBe(2);
    expect(view.getInt16(50, true)).toBe(20);
  });
});
