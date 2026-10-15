import { BinaryReader, readDictionary } from "./binary-reader";

export interface DecodedTexture {
  name: string;
  width: number;
  height: number;
  /** 8-bit RGBA, row 0 at the top -- exactly what `pngjs`'s `PNG.data` wants. */
  rgba: Uint8Array;
}

export type DecodeNsbtxResult = { ok: true; textures: DecodedTexture[]; warnings: string[] } | { ok: false; errors: string[] };

const five = (bits5: number): number => (bits5 << 3) | (bits5 >> 2); // 5-bit channel to 8-bit, same spread this project's encoders use in reverse

/**
 * Decodes an NSBTX (BTX0/TEX0) back to plain RGBA pictures, one a texture. The inverse of `nsbtx.ts`'s own encoder,
 * but reads a wider range of the DS's seven GPU texture formats than this converter ever writes (palette formats
 * of every bit depth, and 16bpp direct color), since a *real* NSBTX (from an actual DS game) may use any of them.
 * The 4x4-block-compressed format (5) and the two translucent-palette formats (1, 3-bit-alpha and 6, 5-bit-alpha)
 * are refused with a clear message rather than guessed at -- their bit-exact semantics are the most involved part
 * of the DS's texture hardware and not needed for anything this project's own Converter writes.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function decodeNsbtx(bytes: Uint8Array): DecodeNsbtxResult {
  const r = new BinaryReader(bytes);
  if (r.stamp() !== "BTX0") return { ok: false, errors: ["This isn't an NSBTX file (it doesn't start with \"BTX0\")."] };
  r.u16();
  r.u16();
  r.u32();
  r.u16();
  r.u16();
  const texOff = r.u32();
  if (new BinaryReader(bytes, texOff).stamp() !== "TEX0") return { ok: false, errors: ["This NSBTX's TEX0 chunk is missing or corrupt."] };

  const tex = new BinaryReader(bytes, texOff + 4);
  tex.u32();
  tex.u32();
  tex.u16(); // block1_len_shr_3
  const texturesOff = tex.u16();
  tex.u32();
  const block1Off = tex.u32();
  tex.u16();
  tex.u16();
  tex.u32();
  tex.u32(); // block2_off
  tex.u32(); // block3_off
  tex.u32();
  tex.u16();
  tex.u16();
  const palettesOff = tex.u32();
  const block4Off = tex.u32();

  const textureEntries = readDictionary(bytes, texOff + texturesOff, 8);
  const paletteEntries = new Map(readDictionary(bytes, texOff + palettesOff, 4).map((e) => [e.name, e]));
  const warnings: string[] = [];
  const textures: DecodedTexture[] = [];

  for (const entry of textureEntries) {
    const teximageParams = entry.data.u32();
    const offsetShr3 = teximageParams & 0xffff;
    const w = (teximageParams >>> 20) & 0x7;
    const h = (teximageParams >>> 23) & 0x7;
    const format = (teximageParams >>> 26) & 0x7;
    const color0Transparent = ((teximageParams >>> 29) & 0x1) === 1;
    const width = 8 << w;
    const height = 8 << h;
    const pixelCount = width * height;
    const dataOff = texOff + block1Off + (offsetShr3 << 3);

    if (format === 5 || format === 1 || format === 6) {
      warnings.push(`"${entry.name}" uses texture format ${format} (${format === 5 ? "4x4 block-compressed" : format === 1 ? "A3I5 translucent" : "A5I3 translucent"}), which isn't supported -- skipped.`);
      continue;
    }
    if (format === 0) continue; // "No Texture": nothing to decode

    const palette = paletteEntries.get(entry.name);
    const paletteBytes = palette ? new BinaryReader(bytes, texOff + block4Off + (palette.data.u16() << 3)) : null;

    const rgba = new Uint8Array(pixelCount * 4);
    const dr = new BinaryReader(bytes, dataOff);
    if (format === 7) {
      // Direct color: one 16-bit texel a pixel, bit15 = alpha (0 = transparent).
      for (let i = 0; i < pixelCount; i++) {
        const texel = dr.u16();
        const opaque = (texel >>> 15) & 1;
        rgba[i * 4] = five(texel & 0x1f);
        rgba[i * 4 + 1] = five((texel >>> 5) & 0x1f);
        rgba[i * 4 + 2] = five((texel >>> 10) & 0x1f);
        rgba[i * 4 + 3] = opaque ? 255 : 0;
      }
    } else {
      // Palette formats: 2 (4-color, 2bpp), 3 (16-color, 4bpp), 4 (256-color, 8bpp).
      const bitsPerTexel = format === 2 ? 2 : format === 3 ? 4 : 8;
      const texelsPerByte = 8 / bitsPerTexel;
      const mask = (1 << bitsPerTexel) - 1;
      for (let i = 0; i < pixelCount; i++) {
        const byte = bytes[dataOff + Math.floor(i / texelsPerByte)];
        const shift = (i % texelsPerByte) * bitsPerTexel;
        const index = (byte >> shift) & mask;
        if (index === 0 && color0Transparent) {
          rgba[i * 4 + 3] = 0;
          continue;
        }
        const color = paletteBytes ? new BinaryReader(bytes, paletteBytes.pos + index * 2).u16() : 0;
        rgba[i * 4] = five(color & 0x1f);
        rgba[i * 4 + 1] = five((color >>> 5) & 0x1f);
        rgba[i * 4 + 2] = five((color >>> 10) & 0x1f);
        rgba[i * 4 + 3] = 255;
      }
    }
    textures.push({ name: entry.name, width, height, rgba });
  }

  if (textures.length === 0 && warnings.length === 0) return { ok: false, errors: ["This NSBTX has no textures to convert."] };
  return { ok: true, textures, warnings };
}
