import { describe, expect, it } from "vitest";

import { computeSceneBudget } from "./budget";
import {
  createSpriteFromRgba,
  getSpriteByteSize,
  getSpritePalette,
  getSpritePixels,
  isSpriteSize,
  SPRITE_SIZES,
  spriteToRgba,
  type ImportedSprite
} from "./imported-sprite";
import { createProjectSnapshot, withUpdatedScene } from "./project-snapshot";
import { createSceneNode, flattenSceneTreeInOrder } from "./scene-node";

function picture(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(pixel(x, y), (y * w + x) * 4);
  return out;
}
function ok(rgba: ArrayLike<number>, w: number, h: number) {
  const result = createSpriteFromRgba(rgba, w, h, { name: "hero" });
  if (!result.ok) throw new Error(`expected success, got: ${result.errors.join(" | ")}`);
  return result;
}
const asSprite = (s: Omit<ImportedSprite, "id">, id = "s1"): ImportedSprite => ({ id, ...s });

describe("sprite sizes", () => {
  it("are the twelve the DS has", () => {
    expect(SPRITE_SIZES).toHaveLength(12);
    expect(isSpriteSize(8, 8)).toBe(true);
    expect(isSpriteSize(32, 64)).toBe(true);
    expect(isSpriteSize(64, 32)).toBe(true);
    expect(isSpriteSize(64, 16)).toBe(false); // not an OAM size
    expect(isSpriteSize(24, 24)).toBe(false);
    expect(isSpriteSize(128, 128)).toBe(false);
  });
});

describe("converting a picture to a DS sprite image", () => {
  it("refuses a size the DS has no sprite for, listing the sizes and never resizing", () => {
    const result = createSpriteFromRgba(new Uint8Array(24 * 24 * 4), 24, 24, { name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/24 x 24/);
      expect(result.errors[0]).toMatch(/8 x 8.*64 x 64.*32 x 64/);
    }
  });

  it("refuses data of the wrong length", () => {
    expect(createSpriteFromRgba(new Uint8Array(10), 8, 8, { name: "x" }).ok).toBe(false);
  });

  it("keeps index 0 for transparent pixels and gives each color its own index, in 5-bit color", () => {
    const rgba = picture(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : x < 6 ? [0, 255, 0, 255] : [0, 0, 255, 0]));
    const { sprite, warnings } = ok(rgba, 8, 8);
    expect(warnings).toEqual([]);
    const s = asSprite(sprite);
    const palette = getSpritePalette(s);
    const pixels = getSpritePixels(s);
    expect(palette.length).toBe(3); // transparent + red + green
    expect(palette[0]).toBe(0);
    expect(pixels[0]).toBe(1);
    expect(palette[pixels[0]]).toBe(31); // red: bits 0-4
    expect(palette[pixels[4]]).toBe(31 << 5); // green: bits 5-9
    expect(pixels[6]).toBe(0);
    expect(pixels[7]).toBe(0);
  });

  it("round-trips to the same picture the editor draws", () => {
    const rgba = picture(16, 8, (x, y) => ((x + y) % 3 === 0 ? [255, 255, 255, 255] : (x + y) % 3 === 1 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    const drawn = spriteToRgba(asSprite(ok(rgba, 16, 8).sprite));
    for (let i = 0; i < 16 * 8; i++) {
      expect(drawn[i * 4 + 3]).toBe(rgba[i * 4 + 3] >= 128 ? 255 : 0);
      if (rgba[i * 4 + 3] >= 128) expect([...drawn.slice(i * 4, i * 4 + 3)]).toEqual([...rgba.slice(i * 4, i * 4 + 3)]);
    }
  });

  it("warns about partly transparent pixels and makes them on or off", () => {
    const rgba = picture(8, 8, (x) => [10, 20, 30, x === 0 ? 100 : x === 1 ? 200 : 255]);
    const { sprite, warnings } = ok(rgba, 8, 8);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/16 pixels are partly transparent/);
    const pixels = getSpritePixels(asSprite(sprite));
    expect(pixels[0]).toBe(0); // alpha 100: clear
    expect(pixels[1]).not.toBe(0); // alpha 200: opaque
  });

  it("reduces a picture with more than 255 colors to 255 and says so", () => {
    // 64 x 64 = 4096 pixels, every 5-bit color of a 16 x 16 x 16 grid: 4096 distinct colors.
    const rgba = picture(64, 64, (x, y) => {
      const n = y * 64 + x;
      return [(n & 15) * 17, ((n >> 4) & 15) * 17, ((n >> 8) & 15) * 17, 255];
    });
    const { sprite, warnings } = ok(rgba, 64, 64);
    const s = asSprite(sprite);
    expect(getSpritePalette(s).length).toBeLessThanOrEqual(256);
    expect(warnings.some((w) => /reduced to 255/.test(w))).toBe(true);
    const pixels = getSpritePixels(s);
    expect(Math.max(...pixels)).toBeLessThanOrEqual(255);
    expect(pixels.every((index) => index > 0)).toBe(true); // nothing was transparent
  });

  it("is deterministic", () => {
    const rgba = picture(32, 32, (x, y) => [(x * 8) & 255, (y * 8) & 255, ((x + y) * 4) & 255, 255]);
    expect(ok(rgba, 32, 32).sprite).toEqual(ok(rgba, 32, 32).sprite);
  });

  it("takes a byte a pixel of sprite memory", () => {
    expect(getSpriteByteSize({ width: 32, height: 16 })).toBe(512);
  });
});

describe("sprite images in the project and budget", () => {
  const sprite = asSprite(ok(picture(16, 16, () => [200, 100, 50, 255]), 16, 16).sprite);

  it("counts the distinct images used on each screen, once each", () => {
    const a = createSceneNode({ name: "A", kind: "Sprite2D", screen: "top" });
    const b = createSceneNode({ name: "B", kind: "Sprite2D", screen: "top" });
    const c = createSceneNode({ name: "C", kind: "Sprite2D", screen: "bottom" });
    a.spriteId = b.spriteId = c.spriteId = sprite.id;
    const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [a, b, c] });
    const [top, bottom] = computeSceneBudget(scene, [], [], [], [sprite]).perScreen;
    expect(top.spriteBytesUsed).toBe(256);
    expect(top.spritePalettesUsed).toBe(1);
    expect(top.spritesUsed).toBe(2);
    expect(bottom.spriteBytesUsed).toBe(256); // its own copy in its own engine's memory
    expect(bottom.spriteBytesLimit).toBe(128 * 1024);
    expect(bottom.spritePalettesLimit).toBe(16);
  });

  it("drops an image no node uses when the scene changes", () => {
    const node = createSceneNode({ name: "A", kind: "Sprite2D" });
    node.spriteId = sprite.id;
    const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
    const project = { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sprites: [sprite] };
    expect(withUpdatedScene(project, scene).sprites).toEqual([sprite]);
    const without = withUpdatedScene(project, { ...scene, children: [] });
    expect(without).not.toHaveProperty("sprites");
  });
});

describe("tree order", () => {
  it("lists a parent then each child's subtree in turn", () => {
    const grandchild = createSceneNode({ name: "g", kind: "Node2D" });
    const first = createSceneNode({ name: "first", kind: "Node2D", children: [grandchild] });
    const second = createSceneNode({ name: "second", kind: "Node2D" });
    const root = createSceneNode({ name: "root", kind: "Node2D", children: [first, second] });
    expect(flattenSceneTreeInOrder(root).map((n) => n.name)).toEqual(["root", "first", "g", "second"]);
  });
});
