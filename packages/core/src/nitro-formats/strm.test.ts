import { describe, expect, it } from "vitest";

import { encodeStrm } from "./strm";

class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    public pos = 0
  ) {}
  u8(): number {
    return this.bytes[this.pos++];
  }
  u16(): number {
    const v = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
    this.pos += 2;
    return v;
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
}

describe("encodeStrm", () => {
  it("writes a valid STRM header for a mono PCM16 stream, with HEAD/DATA sizes that match the real bytes", () => {
    const sampleCount = 100;
    const pcm = new Uint8Array(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      pcm[i * 2] = i & 0xff;
      pcm[i * 2 + 1] = (i >> 8) & 0xff;
    }
    const bytes = encodeStrm({ sampleRate: 16000, channels: [pcm], format: "pcm16", sampleCount });
    const r = new Reader(bytes);
    expect(r.stamp()).toBe("STRM");
    expect(r.u16()).toBe(0xfeff);
    expect(r.u16()).toBe(0x0100);
    expect(r.u32()).toBe(bytes.length);
    expect(r.u16()).toBe(0x10);
    expect(r.u16()).toBe(2);

    expect(r.stamp()).toBe("HEAD");
    expect(r.u32()).toBe(0x50);
    expect(r.u8()).toBe(1); // PCM16
    expect(r.u8()).toBe(0); // loop off
    expect(r.u8()).toBe(1); // mono
    r.u8();
    expect(r.u16()).toBe(16000);
    r.u16(); // time
    expect(r.u32()).toBe(0); // loop offset
    expect(r.u32()).toBe(sampleCount);
    expect(r.u32()).toBe(0x68); // wave data offset
    expect(r.u32()).toBe(1); // one block
    expect(r.u32()).toBe(pcm.length); // block length
    expect(r.u32()).toBe(sampleCount); // samples per block
    expect(r.u32()).toBe(pcm.length); // last block length
    expect(r.u32()).toBe(sampleCount); // samples per last block
    r.pos += 0x20; // reserved

    expect(r.pos).toBe(0x60);
    expect(r.stamp()).toBe("DATA");
    expect(r.u32()).toBe(8 + pcm.length);
    expect(r.pos).toBe(0x68); // matches the header's own "Wave Data Offset"
    for (let i = 0; i < pcm.length; i++) expect(r.u8()).toBe(pcm[i]);
    expect(r.pos).toBe(bytes.length);
  });

  it("writes stereo channel data left-block-then-right-block, and the IMA-ADPCM format code", () => {
    const left = new Uint8Array([1, 2, 3, 4]);
    const right = new Uint8Array([5, 6, 7, 8]);
    const bytes = encodeStrm({ sampleRate: 11025, channels: [left, right], format: "ima-adpcm", sampleCount: 7 });
    const r = new Reader(bytes);
    r.stamp();
    r.u16();
    r.u16();
    r.u32();
    r.u16();
    r.u16();
    r.stamp();
    r.u32();
    expect(r.u8()).toBe(2); // IMA-ADPCM
    r.u8();
    expect(r.u8()).toBe(2); // stereo
    r.pos = 0x68;
    for (const expected of [...left, ...right]) expect(r.u8()).toBe(expected);
  });
});
