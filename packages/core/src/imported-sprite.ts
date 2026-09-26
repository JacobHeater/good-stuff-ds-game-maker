import { DS_HARDWARE_PROFILE } from "./hardware";
import { base64ToBytes, bytesToBase64 } from "./imported-texture";

/**
 * A picture drawn by a `Sprite2D`, stored inside the project already converted to what the DS's sprite engine holds
 * (requirements/scene-designer/STORY.import-sprite-image.md), so the editor shows exactly what the ROM shows and nothing
 * depends on the original file.
 *
 * It is a 256-color paletted image: `pixels` is base64 of one byte per pixel, row 0 at the top, each an index into the palette,
 * and `palette` is base64 of little-endian 16-bit colors (red in bits 0-4, green in 5-9, blue in 10-14; the DS's RGB15).
 * **Index 0 is always the transparent color** (its stored value is 0 and never drawn), so a picture has at most 255 visible colors.
 */
export interface ImportedSprite {
  id: string;
  /** What the user calls it; the file's name without its extension. */
  name: string;
  width: number;
  height: number;
  palette: string;
  pixels: string;
  /**
   * Present when the picture is a **sprite sheet**: a grid of equal frames, each `frameWidth` x `frameHeight` pixels (one of the DS's sprite sizes), read left to right,
   * top to bottom, numbered from 0. `width` and `height` are then the whole sheet, and are whole multiples of the frame. Absent: the picture is one frame.
   * All frames share the sheet's one palette, so a sheet takes one of a screen's 16 sprite palettes however many frames it has.
   */
  frameWidth?: number;
  frameHeight?: number;
}

/** A picture's frame size (the whole picture when it isn't a sheet), its grid and how many frames it has. */
export interface SpriteFrames {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  count: number;
}

export function getSpriteFrames(sprite: Pick<ImportedSprite, "width" | "height" | "frameWidth" | "frameHeight">): SpriteFrames {
  const frameWidth = sprite.frameWidth ?? sprite.width;
  const frameHeight = sprite.frameHeight ?? sprite.height;
  const columns = Math.max(1, Math.floor(sprite.width / frameWidth));
  const rows = Math.max(1, Math.floor(sprite.height / frameHeight));
  return { frameWidth, frameHeight, columns, rows, count: columns * rows };
}

/** One frame's pixels (palette indices, row 0 on top, `frameWidth * frameHeight` of them) cropped out of the sheet; frame 0 of a picture that isn't a sheet is all of it. */
export function getSpriteFramePixels(sprite: ImportedSprite, frame: number): Uint8Array {
  const { frameWidth, frameHeight, columns, count } = getSpriteFrames(sprite);
  const pixels = getSpritePixels(sprite);
  if (count === 1) return pixels;
  const index = Math.min(Math.max(0, Math.floor(frame)), count - 1);
  const left = (index % columns) * frameWidth;
  const top = Math.floor(index / columns) * frameHeight;
  const out = new Uint8Array(frameWidth * frameHeight);
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) out[y * frameWidth + x] = pixels[(top + y) * sprite.width + left + x];
  }
  return out;
}

/** The sizes a DS hardware sprite can have (width x height in pixels): four squares, four wide and four tall. */
export const SPRITE_SIZES: readonly { width: number; height: number }[] = [
  { width: 8, height: 8 },
  { width: 16, height: 16 },
  { width: 32, height: 32 },
  { width: 64, height: 64 },
  { width: 16, height: 8 },
  { width: 32, height: 8 },
  { width: 32, height: 16 },
  { width: 64, height: 32 },
  { width: 8, height: 16 },
  { width: 8, height: 32 },
  { width: 16, height: 32 },
  { width: 32, height: 64 }
];

export function isSpriteSize(width: number, height: number): boolean {
  return SPRITE_SIZES.some((size) => size.width === width && size.height === height);
}

/** "8 x 8, 16 x 16, ..." for messages. */
export const SPRITE_SIZE_LIST = SPRITE_SIZES.map((size) => `${size.width} x ${size.height}`).join(", ");

/** Each of a screen's sprites can use its own 256-color palette, and the DS's sprite engine holds 16 of them. */
export const SPRITE_PALETTES_PER_SCREEN = DS_HARDWARE_PROFILE.graphics2D.spritePalettesPerScreen;

/** How much of a screen's sprite memory an image takes: one byte a pixel (256 colors). */
export function getSpriteByteSize(sprite: { width: number; height: number }): number {
  return sprite.width * sprite.height;
}

/** The most palette entries a sprite can have: index 0 (transparent) and 255 colors. */
export const SPRITE_PALETTE_ENTRIES = 256;

const decodedPalettes = new WeakMap<ImportedSprite, Uint16Array>();
const decodedPixels = new WeakMap<ImportedSprite, Uint8Array>();

/** The sprite's palette as RGB15 values (index 0 is the transparent slot). Decoded once per sprite object and shared; do not mutate it. */
export function getSpritePalette(sprite: ImportedSprite): Uint16Array {
  let palette = decodedPalettes.get(sprite);
  if (!palette) {
    const bytes = base64ToBytes(sprite.palette);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    palette = new Uint16Array(bytes.length / 2);
    for (let i = 0; i < palette.length; i++) palette[i] = view.getUint16(i * 2, true);
    decodedPalettes.set(sprite, palette);
  }
  return palette;
}

/** The sprite's pixels, one palette index each, row 0 on top. Decoded once per sprite object and shared; do not mutate it. */
export function getSpritePixels(sprite: ImportedSprite): Uint8Array {
  let pixels = decodedPixels.get(sprite);
  if (!pixels) {
    pixels = base64ToBytes(sprite.pixels);
    decodedPixels.set(sprite, pixels);
  }
  return pixels;
}

/** The picture as 8-bit RGBA, for drawing in the editor: each 5-bit channel spread back over 0..255, index 0 clear. With `frame`, just that frame of a sheet. */
export function spriteToRgba(sprite: ImportedSprite, frame?: number): Uint8ClampedArray<ArrayBuffer> {
  const palette = getSpritePalette(sprite);
  const pixels = frame === undefined ? getSpritePixels(sprite) : getSpriteFramePixels(sprite, frame);
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  const spread = (five: number): number => Math.round((five * 255) / 31);
  pixels.forEach((index, i) => {
    if (index === 0) return;
    const color = palette[index] ?? 0;
    rgba[i * 4] = spread(color & 31);
    rgba[i * 4 + 1] = spread((color >> 5) & 31);
    rgba[i * 4 + 2] = spread((color >> 10) & 31);
    rgba[i * 4 + 3] = 255;
  });
  return rgba;
}

export type SpriteImportResult =
  | { ok: true; sprite: Omit<ImportedSprite, "id">; warnings: string[] }
  | { ok: false; errors: string[] };

/** One color of the picture (5 bits per channel) and how many pixels have it. */
interface ColorCount {
  r: number;
  g: number;
  b: number;
  count: number;
}

/**
 * Median-cut: repeatedly splits the box of colors with the widest spread along one channel at its weighted median, until there
 * are `target` boxes, and returns each box's weighted average color. Deterministic for a given input.
 */
function medianCut(colors: ColorCount[], target: number): { r: number; g: number; b: number }[] {
  type Box = ColorCount[];
  const boxes: Box[] = [colors];
  const range = (box: Box): { channel: "r" | "g" | "b"; spread: number } => {
    let best: { channel: "r" | "g" | "b"; spread: number } = { channel: "r", spread: -1 };
    for (const channel of ["r", "g", "b"] as const) {
      let min = 31;
      let max = 0;
      for (const color of box) {
        min = Math.min(min, color[channel]);
        max = Math.max(max, color[channel]);
      }
      if (max - min > best.spread) best = { channel, spread: max - min };
    }
    return best;
  };
  while (boxes.length < target) {
    let pick = -1;
    let widest = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { spread } = range(box);
      if (spread > widest) {
        widest = spread;
        pick = i;
      }
    });
    if (pick === -1) break;
    const box = boxes[pick];
    const { channel } = range(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel] || a.r - b.r || a.g - b.g || a.b - b.b);
    const total = sorted.reduce((sum, color) => sum + color.count, 0);
    let seen = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      seen += sorted[i].count;
      cut = i + 1;
      if (seen * 2 >= total) break;
    }
    boxes.splice(pick, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  return boxes.map((box) => {
    const total = box.reduce((sum, color) => sum + color.count, 0);
    const average = (channel: "r" | "g" | "b"): number => Math.round(box.reduce((sum, color) => sum + color[channel] * color.count, 0) / total);
    return { r: average("r"), g: average("g"), b: average("b") };
  });
}

/**
 * Turns a decoded picture (8-bit RGBA, row 0 at the top) into a DS sprite image, or refuses it with reasons. Pure: the caller
 * decodes the PNG (the Electron main process does). The size is never adjusted: it must be one of the DS's sprite sizes
 * (`SPRITE_SIZES`) or it is refused. Colors are reduced to the DS's 5 bits a channel; a picture with more than 255 distinct
 * colors after that is reduced to 255 (median cut) and a warning says so. A pixel with alpha of 128 or more is opaque, the
 * rest are transparent (a warning counts the partly transparent ones).
 * See requirements/scene-designer/STORY.import-sprite-image.md.
 */
export function createSpriteFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: { name: string; /** Import a sheet of frames this size instead of one picture. */ frame?: { width: number; height: number } }
): SpriteImportResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, errors: ["The image has no pixels."] };
  }
  if (rgba.length !== width * height * 4) {
    return { ok: false, errors: [`The image data is the wrong length for ${width} x ${height} pixels.`] };
  }
  const frame = options.frame;
  if (frame) {
    if (!isSpriteSize(frame.width, frame.height)) {
      return { ok: false, errors: [`A frame of ${frame.width} x ${frame.height} pixels isn't a size the DS has a sprite for. A frame has to be one of: ${SPRITE_SIZE_LIST}.`] };
    }
    if (width % frame.width !== 0 || height % frame.height !== 0) {
      return {
        ok: false,
        errors: [`The image is ${width} x ${height} pixels, which isn't a whole number of ${frame.width} x ${frame.height} frames. Make the sheet's width a multiple of ${frame.width} and its height a multiple of ${frame.height}.`]
      };
    }
  } else if (!isSpriteSize(width, height)) {
    return {
      ok: false,
      errors: [
        `The image is ${width} x ${height} pixels, but a DS sprite has to be one of these sizes: ${SPRITE_SIZE_LIST}. ` +
          "Resize or crop it in your image editor and import it again. (To import a sheet of frames, say how big one frame is.)"
      ]
    };
  }

  const five = (channel: number): number => Math.round((channel * 31) / 255);
  const pixelCount = width * height;
  // The 15-bit color of each pixel, or -1 for a transparent one.
  const colors = new Int32Array(pixelCount);
  const counts = new Map<number, number>();
  let partlyTransparent = 0;
  for (let i = 0; i < pixelCount; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha > 0 && alpha < 255) partlyTransparent++;
    if (alpha < 128) {
      colors[i] = -1;
      continue;
    }
    const color = five(rgba[i * 4]) | (five(rgba[i * 4 + 1]) << 5) | (five(rgba[i * 4 + 2]) << 10);
    colors[i] = color;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const distinct = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const maxColors = SPRITE_PALETTE_ENTRIES - 1;
  const palette = new Uint16Array(Math.min(distinct.length, maxColors) + 1); // entry 0 stays 0: transparent
  const indexOf = new Map<number, number>();
  const warnings: string[] = [];

  if (distinct.length <= maxColors) {
    distinct.forEach(([color], i) => {
      palette[i + 1] = color;
      indexOf.set(color, i + 1);
    });
  } else {
    const entries: ColorCount[] = distinct.map(([color, count]) => ({ r: color & 31, g: (color >> 5) & 31, b: (color >> 10) & 31, count }));
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
    warnings.push(
      `The image has ${distinct.length} distinct colors; a DS sprite has at most ${maxColors} (plus transparent), so they were reduced to ${maxColors} and it may look different.`
    );
  }

  const pixels = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) pixels[i] = colors[i] === -1 ? 0 : (indexOf.get(colors[i]) ?? 0);

  if (partlyTransparent > 0) {
    warnings.push(
      `${partlyTransparent} pixel${partlyTransparent === 1 ? " is" : "s are"} partly transparent; the DS only has on/off transparency, so ${partlyTransparent === 1 ? "it became" : "they became"} fully opaque or fully clear.`
    );
  }

  const paletteBytes = new Uint8Array(palette.length * 2);
  const view = new DataView(paletteBytes.buffer);
  palette.forEach((color, i) => view.setUint16(i * 2, color, true));
  return {
    ok: true,
    sprite: {
      name: options.name.trim() || "Sprite",
      width,
      height,
      palette: bytesToBase64(paletteBytes),
      pixels: bytesToBase64(pixels),
      ...(frame && (frame.width !== width || frame.height !== height) ? { frameWidth: frame.width, frameHeight: frame.height } : {})
    },
    warnings
  };
}
