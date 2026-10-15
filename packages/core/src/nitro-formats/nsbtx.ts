import { medianCut, type ColorCount } from "../imported-sprite";
import { BinaryWriter } from "./binary-writer";
import { dictionarySize, writeDictionary } from "./nitro-dictionary";

/** The DS 3D GPU's own valid texture sizes on each axis (GBATEK TEXIMAGE_PARAM: `8 SHL N`, N = 0..7). */
const TEXTURE_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024];

export interface NsbtxInput {
  /** The texture's Name inside the file (also the Name its palette is paired with) -- at most 16 ASCII characters. */
  name: string;
  width: number;
  height: number;
  /** 8-bit RGBA, row 0 at the top, `width * height * 4` bytes (exactly what `pngjs`/a decoded PNG already is). */
  rgba: Uint8Array;
}

export type EncodeNsbtxResult = { ok: true; bytes: Uint8Array; warnings: string[] } | { ok: false; errors: string[] };

function sizeExponent(size: number): number | null {
  const index = TEXTURE_SIZES.indexOf(size);
  return index === -1 ? null : index;
}

/**
 * Converts a decoded PNG into an NSBTX (BTX0/TEX0) -- a real Nintendo DS texture file, the same container format
 * the official Nitro SDK's own texture converter produces, readable by any NSBMD/NSBTX-aware tool. Unlike this
 * project's own 2D sprites (which fit the small discrete OAM sprite sizes), a DS 3D texture only needs each axis
 * to be a power of two from 8 to 1024 -- this refuses anything else rather than resizing it, so the Converter
 * never silently distorts an image.
 *
 * Always encodes as the GPU's "256-Color Palette Texture" format (format 4, 8bpp): the DS's biggest palette
 * format, keeping conversion simple and lossless up to 256 colors; a picture with more gets reduced the same
 * median-cut way `createSpriteFromRgba` already reduces a 2D sprite's colors. Palette index 0 is always the
 * transparent color, the same convention every other imported image in this project already uses.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function encodeNsbtx(input: NsbtxInput): EncodeNsbtxResult {
  const { name, width, height, rgba } = input;
  const w = sizeExponent(width);
  const h = sizeExponent(height);
  if (w === null || h === null) {
    return { ok: false, errors: [`This image is ${width} x ${height} pixels, but a DS 3D texture's width and height must each be one of: ${TEXTURE_SIZES.join(", ")}.`] };
  }
  if (rgba.length !== width * height * 4) return { ok: false, errors: [`The image data is the wrong length for ${width} x ${height} pixels.`] };

  const warnings: string[] = [];
  const five = (channel: number): number => Math.round((channel * 31) / 255);
  const pixelCount = width * height;
  const colorAt = new Int32Array(pixelCount); // -1 for transparent, else packed 5-5-5
  const counts = new Map<number, number>();
  let partlyTransparent = 0;
  for (let i = 0; i < pixelCount; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha > 0 && alpha < 255) partlyTransparent++;
    if (alpha < 128) {
      colorAt[i] = -1;
      continue;
    }
    const packed = five(rgba[i * 4]) | (five(rgba[i * 4 + 1]) << 5) | (five(rgba[i * 4 + 2]) << 10);
    colorAt[i] = packed;
    counts.set(packed, (counts.get(packed) ?? 0) + 1);
  }
  if (partlyTransparent > 0) warnings.push(`${partlyTransparent} pixel${partlyTransparent === 1 ? " is" : "s are"} partly transparent; the DS only has on/off transparency per texel, so they became fully opaque or fully clear.`);

  const maxColors = 255; // plus the always-reserved transparent index 0
  const distinct = [...counts.entries()];
  const palette = new Uint16Array(Math.min(distinct.length, maxColors) + 1); // entry 0 stays 0 (transparent)
  const indexOf = new Map<number, number>();
  if (distinct.length <= maxColors) {
    distinct.forEach(([packed], i) => {
      palette[i + 1] = packed;
      indexOf.set(packed, i + 1);
    });
  } else {
    const entries: ColorCount[] = distinct.map(([packed, count]) => ({ r: packed & 31, g: (packed >> 5) & 31, b: (packed >> 10) & 31, count }));
    const chosen = medianCut(entries, maxColors);
    chosen.forEach((c, i) => {
      palette[i + 1] = c.r | (c.g << 5) | (c.b << 10);
    });
    for (const entry of entries) {
      let best = 0;
      let bestDistance = Infinity;
      chosen.forEach((c, i) => {
        const distance = (c.r - entry.r) ** 2 + (c.g - entry.g) ** 2 + (c.b - entry.b) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i + 1;
        }
      });
      indexOf.set(entry.r | (entry.g << 5) | (entry.b << 10), best);
    }
    warnings.push(`The image has ${distinct.length} distinct colors; a DS texture palette has at most 256 (including transparent), so they were reduced to 256.`);
  }
  const texelIndices = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) texelIndices[i] = colorAt[i] === -1 ? 0 : (indexOf.get(colorAt[i]) ?? 0);

  // Layout: header, then the two dictionaries, then the texel block, then the palette block -- all sizes are known up front, so offsets need no backward patching.
  const headerSize = 0x38;
  const texturesDictOff = headerSize;
  const texturesDictSize = dictionarySize(1, 8);
  const palettesOff = texturesDictOff + texturesDictSize;
  const palettesDictSize = dictionarySize(1, 4);
  const block1Off = palettesOff + palettesDictSize;
  const block1Len = Math.ceil(texelIndices.length / 8) * 8; // "shr_3" lengths must be a multiple of 8 bytes
  const block4Off = block1Off + block1Len;
  const block4Len = Math.ceil(palette.length * 2 / 8) * 8;

  const teximageParams = (0 /* offset_shr_3 */ | (w << 20) | (h << 23) | (4 << 26) | (1 << 29)) >>> 0; // format 4 (256-color), color0 transparent

  const tex = new BinaryWriter();
  tex.bytes_([0x54, 0x45, 0x58, 0x30]); // "TEX0"
  tex.u32(0);
  tex.u32(0);
  tex.u16(block1Len >> 3);
  tex.u16(texturesDictOff);
  tex.u32(0);
  tex.u32(block1Off);
  tex.u16(0); // block2_len_shr_3 (no compressed texture data)
  tex.u16(0);
  tex.u32(0);
  tex.u32(0); // block2_off
  tex.u32(0); // block3_off
  tex.u32(0);
  tex.u16(block4Len >> 3);
  tex.u16(0);
  tex.u32(palettesOff);
  tex.u32(block4Off);

  writeDictionary(tex, [{ name, data: [...u32bytes(teximageParams), 0, 0, 0, 0] }], 8);
  writeDictionary(tex, [{ name, data: [0, 0, 0, 0] }], 4); // Palette.offset_shr_3 = 0 (it sits at the very start of Block4), unknown = 0
  // Written out to exactly `block1Len`/`block4Len` bytes (zero-padded), matching the precomputed offsets above --
  // block offsets themselves don't need to be 8-byte aligned, only the `_len_shr_3` lengths do.
  tex.bytes_(texelIndices);
  for (let i = texelIndices.length; i < block1Len; i++) tex.u8(0);
  for (let i = 0; i < palette.length; i++) tex.u16(palette[i]);
  for (let i = palette.length * 2; i < block4Len; i++) tex.u8(0);

  const texBytes = tex.toBytes();

  const containerHeaderSize = 16 + 4; // Header (16) + one subfile offset
  const out = new BinaryWriter();
  out.bytes_([0x42, 0x54, 0x58, 0x30]); // "BTX0"
  out.u16(0xfeff);
  out.u16(1);
  out.u32(containerHeaderSize + texBytes.length);
  out.u16(16);
  out.u16(1);
  out.u32(containerHeaderSize);
  out.bytes_(texBytes);

  return { ok: true, bytes: out.toBytes(), warnings };
}

function u32bytes(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
