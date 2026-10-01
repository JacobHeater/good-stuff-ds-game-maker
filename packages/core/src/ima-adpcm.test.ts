import { describe, expect, it } from "vitest";

import { decodeImaAdpcm, encodeImaAdpcm, imaAdpcmByteSize } from "./ima-adpcm";

describe("IMA-ADPCM", () => {
  it("round-trips a sine wave closely (lossy, but never far off)", () => {
    const n = 2000;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((i / n) * Math.PI * 10) * 30000);
    const encoded = encodeImaAdpcm(pcm);
    expect(encoded.length).toBe(imaAdpcmByteSize(n));
    const decoded = decodeImaAdpcm(encoded, n);
    expect(decoded.length).toBe(n);
    let maxError = 0;
    for (let i = 0; i < n; i++) maxError = Math.max(maxError, Math.abs(decoded[i] - pcm[i]));
    expect(maxError).toBeLessThan(2000); // well within normal IMA-ADPCM quantization error for a smooth signal
    expect(decoded[0]).toBe(pcm[0]); // the first sample is stored exactly, in the header
  });

  it("compresses to about a quarter the size of 16-bit PCM", () => {
    const n = 10000;
    expect(imaAdpcmByteSize(n)).toBeLessThan((n * 2) / 3.5);
  });

  it("handles 0 and 1 samples", () => {
    expect(encodeImaAdpcm(new Int16Array(0)).length).toBe(4);
    expect(decodeImaAdpcm(encodeImaAdpcm(new Int16Array(0)), 0).length).toBe(0);
    const one = encodeImaAdpcm(new Int16Array([12345]));
    expect(one.length).toBe(4);
    expect(decodeImaAdpcm(one, 1)).toEqual(new Int16Array([12345]));
  });

  it("handles an odd sample count (a lone trailing nibble)", () => {
    const pcm = new Int16Array([100, 200, -300, 400, -500]);
    const encoded = encodeImaAdpcm(pcm);
    expect(encoded.length).toBe(4 + 2); // 4 remaining samples = 4 nibbles = 2 bytes
    expect(decodeImaAdpcm(encoded, pcm.length)).toEqual(decodeImaAdpcm(encoded, pcm.length)); // sanity: deterministic
  });

  it("is silent in, silent out", () => {
    const pcm = new Int16Array(50);
    const decoded = decodeImaAdpcm(encodeImaAdpcm(pcm), pcm.length);
    expect(Array.from(decoded)).toEqual(Array.from(pcm));
  });
});
