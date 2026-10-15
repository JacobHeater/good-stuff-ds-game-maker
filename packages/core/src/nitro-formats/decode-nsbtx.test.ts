import { describe, expect, it } from "vitest";

import { decodeNsbtx } from "./decode-nsbtx";
import { encodeNsbtx } from "./nsbtx";

function solidRgba(width: number, height: number, rgb: [number, number, number], alpha = 255): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set([...rgb, alpha], i * 4);
  return out;
}

describe("decodeNsbtx", () => {
  it("round-trips a solid-color texture exactly through encodeNsbtx (within 5-bit color rounding)", () => {
    const rgba = solidRgba(32, 16, [120, 40, 200]);
    const encoded = encodeNsbtx({ name: "Wall", width: 32, height: 16, rgba });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = decodeNsbtx(encoded.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.textures).toHaveLength(1);
    const [texture] = decoded.textures;
    expect(texture.name).toBe("Wall");
    expect(texture.width).toBe(32);
    expect(texture.height).toBe(16);
    // 8-bit -> 5-bit -> 8-bit loses the low 3 bits; a channel can be off by a few units.
    for (let i = 0; i < 32 * 16; i++) {
      expect(Math.abs(texture.rgba[i * 4] - 120)).toBeLessThanOrEqual(8);
      expect(Math.abs(texture.rgba[i * 4 + 1] - 40)).toBeLessThanOrEqual(8);
      expect(Math.abs(texture.rgba[i * 4 + 2] - 200)).toBeLessThanOrEqual(8);
      expect(texture.rgba[i * 4 + 3]).toBe(255);
    }
  });

  it("round-trips a fully transparent pixel back to alpha 0", () => {
    const rgba = solidRgba(8, 8, [10, 10, 10], 0);
    const encoded = encodeNsbtx({ name: "Blank", width: 8, height: 8, rgba });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = decodeNsbtx(encoded.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.textures[0].rgba[3]).toBe(0);
  });

  it("round-trips many distinct colors (median-cut reduced) without crashing and keeps full opacity", () => {
    const rgba = new Uint8Array(32 * 32 * 4);
    const eight = (fiveBit: number): number => Math.round((fiveBit * 255) / 31);
    for (let i = 0; i < 32 * 32; i++) rgba.set([eight(i & 0x1f), eight((i >> 5) & 0x1f), eight((i >> 10) & 0x1f), 255], i * 4);
    const encoded = encodeNsbtx({ name: "Rainbow", width: 32, height: 32, rgba });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = decodeNsbtx(encoded.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.textures[0].rgba).toHaveLength(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) expect(decoded.textures[0].rgba[i * 4 + 3]).toBe(255);
  });

  it("refuses a file that isn't an NSBTX", () => {
    const result = decodeNsbtx(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/BTX0/);
  });
});
