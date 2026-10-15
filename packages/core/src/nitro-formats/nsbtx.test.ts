import { describe, expect, it } from "vitest";

import { encodeNsbtx } from "./nsbtx";

/** A minimal reader for this test file's own round-trip checks (not a general NSBTX parser). */
class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    private pos = 0
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

function solidRgba(width: number, height: number, rgb: [number, number, number], alpha = 255): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set([...rgb, alpha], i * 4);
  return out;
}

describe("encodeNsbtx", () => {
  it("writes a valid BTX0/TEX0 container whose header fields match the real file layout", () => {
    const result = encodeNsbtx({ name: "Wall", width: 16, height: 16, rgba: solidRgba(16, 16, [200, 50, 50]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = new Reader(result.bytes);
    expect(r.stamp()).toBe("BTX0");
    expect(r.u16()).toBe(0xfeff);
    r.u16(); // version
    const filesize = r.u32();
    expect(filesize).toBe(result.bytes.length);
    expect(r.u16()).toBe(16); // header size
    expect(r.u16()).toBe(1); // one subfile
    const tex0Off = r.u32();
    r.seek(tex0Off);
    expect(r.stamp()).toBe("TEX0");
  });

  it("round-trips a solid-color texture's pixels exactly through its own palette", () => {
    const rgba = solidRgba(32, 8, [120, 40, 200]);
    const result = encodeNsbtx({ name: "Tile", width: 32, height: 8, rgba });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = new Reader(result.bytes).seek(16);
    const tex0Off = r.u32();
    r.seek(tex0Off);
    r.stamp();
    r.u32();
    r.u32();
    const block1LenShr3 = r.u16();
    const texturesOff = r.u16();
    r.u32();
    const block1Off = r.u32();
    r.u16();
    r.u16();
    r.u32();
    r.u32();
    r.u32();
    r.u32();
    const block4LenShr3 = r.u16();
    r.u16();
    const palettesOff = r.u32();
    const block4Off = r.u32();

    expect(block1LenShr3 * 8).toBeGreaterThanOrEqual(32 * 8);
    expect(block4LenShr3 * 8).toBeGreaterThan(0);

    // Read the texture dictionary's one entry to get teximage_params, confirming width/height/format decode correctly.
    r.seek(tex0Off + texturesOff);
    r.u8(); // dummy
    const texCount = r.u8();
    expect(texCount).toBe(1);
    r.u16(); // size
    r.u16(); // unknown subheader size
    r.u16(); // unknown section size
    r.u32(); // unknown constant
    r.u32(); // unknown[0] (one entry)
    r.u16(); // element_size
    r.u16(); // data_section_size
    const teximageParams = r.u32();
    const w = (teximageParams >>> 20) & 0x7;
    const h = (teximageParams >>> 23) & 0x7;
    const format = (teximageParams >>> 26) & 0x7;
    const color0 = (teximageParams >>> 29) & 0x1;
    expect(8 << w).toBe(32);
    expect(8 << h).toBe(8);
    expect(format).toBe(4); // 256-color palette
    expect(color0).toBe(1);

    // Read Block1 (texel indices) and Block4 (palette), and reconstruct the pixel colors.
    r.seek(tex0Off + block1Off);
    const texel = r.u8();
    expect(texel).not.toBe(0); // not the reserved-transparent index, since this pixel is fully opaque

    r.seek(tex0Off + block4Off + texel * 2);
    const rgb15 = r.u16();
    const five = (channel: number): number => Math.round((channel * 31) / 255);
    const expectedR = five(120);
    const expectedG = five(40);
    const expectedB = five(200);
    expect(rgb15 & 0x1f).toBe(expectedR);
    expect((rgb15 >> 5) & 0x1f).toBe(expectedG);
    expect((rgb15 >> 10) & 0x1f).toBe(expectedB);

    // The palette dictionary names its one entry "Tile" too, pairing it with the same-named texture.
    r.seek(tex0Off + palettesOff);
    r.u8();
    expect(r.u8()).toBe(1); // one palette entry
  });

  it("marks a transparent pixel as palette index 0", () => {
    const rgba = solidRgba(8, 8, [10, 10, 10], 0);
    const result = encodeNsbtx({ name: "Blank", width: 8, height: 8, rgba });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = new Reader(result.bytes).seek(16);
    const tex0Off = r.u32();
    r.seek(tex0Off + 0x14); // block1_off
    const block1Off = r.u32();
    r.seek(tex0Off + block1Off);
    expect(r.u8()).toBe(0);
  });

  it("refuses a size that isn't a valid DS texture size", () => {
    const result = encodeNsbtx({ name: "Bad", width: 50, height: 37, rgba: solidRgba(50, 37, [1, 2, 3]) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/8, 16, 32, 64, 128, 256, 512, 1024/);
  });

  it("warns and reduces colors past 256 distinct colors", () => {
    // Each pixel's own index, decomposed directly into 5-bit R/G/B (scaled back up to 8-bit), guarantees 300 distinct
    // post-quantization colors for the first 300 pixels -- unlike a modular formula, which can cycle back onto
    // colors it already used well before reaching the pixel count, this can't collide below 32*32*32 pixels.
    const rgba = new Uint8Array(32 * 32 * 4);
    const eight = (five: number): number => Math.round((five * 255) / 31);
    for (let i = 0; i < 32 * 32; i++) rgba.set([eight(i & 0x1f), eight((i >> 5) & 0x1f), eight((i >> 10) & 0x1f), 255], i * 4);
    const result = encodeNsbtx({ name: "Rainbow", width: 32, height: 32, rgba });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("256"))).toBe(true);
  });
});
