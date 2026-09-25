import { DS_HARDWARE_PROFILE } from "./hardware";

/**
 * A picture applied to 3D meshes, stored inside the project already converted to what the DS holds
 * (requirements/persistence/TASK.embed-imported-textures-in-project-file.md), so the editor shows exactly
 * what the ROM shows and nothing depends on the original file.
 *
 * `texels` is base64 of little-endian 16-bit values, one per pixel, row 0 at the top of the picture:
 * red in bits 0-4, green in 5-9, blue in 10-14, and bit 15 set for an opaque pixel. That is the DS's
 * 16-bit direct-color texture format (`GL_RGBA` in libnds), so the runtime uploads it as it is.
 */
export interface ImportedTexture {
  id: string;
  /** What the user calls it; the file's name without its extension. */
  name: string;
  width: number;
  height: number;
  texels: string;
}

/** Each side of a DS texture is one of these. */
export const TEXTURE_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024] as const;

export function isTextureSize(value: number): boolean {
  return (TEXTURE_SIZES as readonly number[]).includes(value);
}

/** The DS encodes a side of 8, 16, ... 1024 as 0, 1, ... 7. */
export function textureSizeClass(side: number): number {
  return TEXTURE_SIZES.indexOf(side as (typeof TEXTURE_SIZES)[number]);
}

/** How much of the DS's texture memory a texture takes: two bytes a pixel. */
export function getTextureByteSize(texture: { width: number; height: number }): number {
  return texture.width * texture.height * 2;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Throws on text that isn't base64. */
export function base64ToBytes(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

export function encodeTexels(texels: Uint16Array): string {
  const bytes = new Uint8Array(texels.length * 2);
  const view = new DataView(bytes.buffer);
  texels.forEach((texel, i) => view.setUint16(i * 2, texel, true));
  return bytesToBase64(bytes);
}

const decoded = new WeakMap<ImportedTexture, Uint16Array>();

/** The texture's 16-bit values. Decoded once per texture object and shared; do not mutate it. */
export function getTextureTexels(texture: ImportedTexture): Uint16Array {
  let texels = decoded.get(texture);
  if (!texels) {
    const bytes = base64ToBytes(texture.texels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    texels = new Uint16Array(bytes.length / 2);
    for (let i = 0; i < texels.length; i++) texels[i] = view.getUint16(i * 2, true);
    decoded.set(texture, texels);
  }
  return texels;
}

/** The picture as 8-bit RGBA, for drawing in the editor: each 5-bit channel spread back over 0..255. */
export function texelsToRgba(texels: Uint16Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(texels.length * 4);
  const spread = (five: number): number => Math.round((five * 255) / 31);
  texels.forEach((texel, i) => {
    rgba[i * 4] = spread(texel & 31);
    rgba[i * 4 + 1] = spread((texel >> 5) & 31);
    rgba[i * 4 + 2] = spread((texel >> 10) & 31);
    rgba[i * 4 + 3] = texel & 0x8000 ? 255 : 0;
  });
  return rgba;
}

export type TextureImportResult =
  | { ok: true; texture: Omit<ImportedTexture, "id">; warnings: string[] }
  | { ok: false; errors: string[] };

const SIZE_LIST = TEXTURE_SIZES.join(", ");

/**
 * Turns a decoded picture (8-bit RGBA, row 0 at the top) into a DS texture, or refuses it with reasons. Pure:
 * the caller decodes the PNG (the Electron main process does). Sizes are never adjusted: each side must be a
 * power of two from 8 to 1024, and the texture must fit in the DS's texture memory, or it is refused.
 * See requirements/scene-designer/STORY.mesh-textures.md.
 */
export function createTextureFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: { name: string }
): TextureImportResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, errors: ["The image has no pixels."] };
  }
  if (rgba.length !== width * height * 4) {
    return { ok: false, errors: [`The image data is the wrong length for ${width} x ${height} pixels.`] };
  }
  const badSides: string[] = [];
  if (!isTextureSize(width)) badSides.push(`the width (${width})`);
  if (!isTextureSize(height)) badSides.push(`the height (${height})`);
  if (badSides.length > 0) {
    return {
      ok: false,
      errors: [
        `The image is ${width} x ${height} pixels, but the DS needs each side to be a power of two from ${TEXTURE_SIZES[0]} to ${TEXTURE_SIZES[TEXTURE_SIZES.length - 1]} (${SIZE_LIST}); ` +
          `${badSides.join(" and ")} ${badSides.length === 1 ? "isn't" : "aren't"}. Resize it in your image editor and import it again.`
      ]
    };
  }
  const bytes = getTextureByteSize({ width, height });
  const memory = DS_HARDWARE_PROFILE.memory.textureMemoryBytes;
  if (bytes > memory) {
    return {
      ok: false,
      errors: [
        `A ${width} x ${height} texture would need ${bytes / 1024} KB of texture memory, but the DS has ${memory / 1024} KB in total. Use a smaller image.`
      ]
    };
  }

  const texels = new Uint16Array(width * height);
  const five = (channel: number): number => Math.round((channel * 31) / 255);
  let partlyTransparent = 0;
  for (let i = 0; i < texels.length; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha > 0 && alpha < 255) partlyTransparent++;
    texels[i] = five(rgba[i * 4]) | (five(rgba[i * 4 + 1]) << 5) | (five(rgba[i * 4 + 2]) << 10) | (alpha >= 128 ? 0x8000 : 0);
  }

  const warnings: string[] = [];
  if (partlyTransparent > 0) {
    warnings.push(
      `${partlyTransparent} pixel${partlyTransparent === 1 ? " is" : "s are"} partly transparent; the DS only has on/off transparency, so ${partlyTransparent === 1 ? "it became" : "they became"} fully opaque or fully clear.`
    );
  }
  return {
    ok: true,
    texture: { name: options.name.trim() || "Texture", width, height, texels: encodeTexels(texels) },
    warnings
  };
}
