import { spriteToRgba, type ImportedSprite } from "@goodstuff/core";

const cache = new WeakMap<ImportedSprite, string>();
const frameCache = new WeakMap<ImportedSprite, Map<number, string>>();

function toDataUrl(sprite: ImportedSprite, frame: number | undefined, width: number, height: number): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(spriteToRgba(sprite, frame), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * The sprite image as a PNG data URL, for an <img> in the 2D viewport and the Inspector. Drawn from the same palette and pixels the ROM
 * gets (`spriteToRgba`), transparent where index 0 is, so what the editor shows is what the DS draws. Cached per image object (an image is
 * immutable once imported). Returns null where a canvas isn't available (a test environment without a DOM). For a sprite sheet this is the whole sheet.
 */
export function spriteDataUrl(sprite: ImportedSprite): string | null {
  const known = cache.get(sprite);
  if (known !== undefined) return known;
  const url = toDataUrl(sprite, undefined, sprite.width, sprite.height);
  if (url) cache.set(sprite, url);
  return url;
}

/** One frame of a sprite sheet (the frame is `frameWidth` x `frameHeight`), as a data URL; cached per sheet and frame. */
export function spriteFrameDataUrl(sprite: ImportedSprite, frame: number): string | null {
  let frames = frameCache.get(sprite);
  if (!frames) {
    frames = new Map();
    frameCache.set(sprite, frames);
  }
  const known = frames.get(frame);
  if (known !== undefined) return known;
  const url = toDataUrl(sprite, frame, sprite.frameWidth ?? sprite.width, sprite.frameHeight ?? sprite.height);
  if (url) frames.set(frame, url);
  return url;
}
