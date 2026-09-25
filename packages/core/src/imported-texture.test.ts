import { describe, expect, it } from "vitest";

import { computeSceneBudget } from "./budget";
import {
  base64ToBytes,
  bytesToBase64,
  createTextureFromRgba,
  encodeTexels,
  getTextureByteSize,
  getTextureTexels,
  isTextureSize,
  TEXTURE_SIZES,
  textureSizeClass,
  texelsToRgba,
  type ImportedTexture
} from "./imported-texture";
import { resolveMeshTexture } from "./mesh-geometry";
import { createProjectSnapshot, withUpdatedScene } from "./project-snapshot";
import { createSceneNode } from "./scene-node";

/** A w x h picture of one color. */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([r, g, b, a], i * 4);
  return out;
}
function ok(rgba: ArrayLike<number>, w: number, h: number, name = "tex") {
  const result = createTextureFromRgba(rgba, w, h, { name });
  if (!result.ok) throw new Error(`expected success, got: ${result.errors.join(" | ")}`);
  return result;
}
function refused(rgba: ArrayLike<number>, w: number, h: number): string[] {
  const result = createTextureFromRgba(rgba, w, h, { name: "tex" });
  if (result.ok) throw new Error("expected the import to be refused");
  return result.errors;
}
const asTexture = (t: Omit<ImportedTexture, "id">, id = "t1"): ImportedTexture => ({ id, ...t });

describe("converting a picture to a DS texture", () => {
  it("packs 15-bit color with red in the low bits and an opaque flag in bit 15", () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    const put = (i: number, r: number, g: number, b: number, a: number): void => void rgba.set([r, g, b, a], i * 4);
    put(0, 255, 0, 0, 255); // red
    put(1, 0, 255, 0, 255); // green
    put(2, 0, 0, 255, 255); // blue
    put(3, 255, 255, 255, 255); // white
    put(4, 255, 0, 0, 0); // clear
    put(5, 0, 0, 0, 255); // black, opaque
    const texture = asTexture(ok(rgba, 8, 8).texture);
    const texels = getTextureTexels(texture);
    expect(texels[0]).toBe(0x8000 | 31); // red is the low five bits
    expect(texels[1]).toBe(0x8000 | (31 << 5));
    expect(texels[2]).toBe(0x8000 | (31 << 10));
    expect(texels[3]).toBe(0xffff);
    expect(texels[4]).toBe(31); // clear: opaque flag off, color kept
    expect(texels[5]).toBe(0x8000);
    expect(texels).toHaveLength(64);
  });

  it("rounds 8-bit channels to 5 bits", () => {
    const texels = getTextureTexels(asTexture(ok(solid(8, 8, 128, 130, 7), 8, 8).texture));
    // 128 * 31 / 255 = 15.56 -> 16; 130 -> 15.8 -> 16; 7 -> 0.85 -> 1
    expect(texels[0]).toBe(0x8000 | 16 | (16 << 5) | (1 << 10));
  });

  it("keeps row 0 as the top of the picture", () => {
    const rgba = solid(8, 8, 0, 0, 0);
    rgba.set([255, 0, 0, 255], 0); // top-left pixel red
    rgba.set([0, 255, 0, 255], (7 * 8 + 7) * 4); // bottom-right pixel green
    const texels = getTextureTexels(asTexture(ok(rgba, 8, 8).texture));
    expect(texels[0] & 31).toBe(31);
    expect((texels[63] >> 5) & 31).toBe(31);
  });

  it("treats alpha 128 and above as opaque, and reports partly transparent pixels", () => {
    const rgba = solid(8, 8, 10, 10, 10);
    rgba[3] = 127; // just under: clear
    rgba[7] = 128; // just over: opaque
    rgba[11] = 0; // fully clear: not "partly"
    const result = ok(rgba, 8, 8);
    const texels = getTextureTexels(asTexture(result.texture));
    expect(texels[0] & 0x8000).toBe(0);
    expect(texels[1] & 0x8000).toBe(0x8000);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/2 pixels are partly transparent/);
    expect(ok(solid(8, 8, 1, 2, 3), 8, 8).warnings).toEqual([]);
  });

  it("round-trips through the stored base64 and back to 8-bit RGBA for the viewport", () => {
    const rgba = solid(16, 8, 255, 128, 0);
    const texture = asTexture(ok(rgba, 16, 8).texture);
    expect(texture.texels).toBe(encodeTexels(getTextureTexels(texture)));
    const back = texelsToRgba(getTextureTexels(texture));
    expect(back[0]).toBe(255);
    expect(back[1]).toBe(Math.round((Math.round((128 * 31) / 255) * 255) / 31));
    expect(back[2]).toBe(0);
    expect(back[3]).toBe(255);
    expect(getTextureTexels(texture)).toBe(getTextureTexels(texture)); // decoded once
  });

  it("names the texture, with a fallback", () => {
    expect(createTextureFromRgba(solid(8, 8, 0, 0, 0), 8, 8, { name: "  bricks " })).toMatchObject({ ok: true, texture: { name: "bricks" } });
    expect(createTextureFromRgba(solid(8, 8, 0, 0, 0), 8, 8, { name: " " })).toMatchObject({ ok: true, texture: { name: "Texture" } });
  });
});

describe("what it refuses", () => {
  it("a side that isn't a power of two from 8 to 1024, saying which side and what is allowed", () => {
    const [message] = refused(solid(100, 60, 0, 0, 0), 100, 60);
    expect(message).toContain("100 x 60");
    expect(message).toContain("8, 16, 32, 64, 128, 256, 512, 1024");
    expect(message).toMatch(/the width \(100\) and the height \(60\) aren't/);
    expect(refused(solid(64, 60, 0, 0, 0), 64, 60)[0]).toMatch(/the height \(60\) isn't/);
    expect(refused(solid(4, 4, 0, 0, 0), 4, 4)[0]).toMatch(/aren't/); // a power of two, but too small
    expect(refused(solid(2048, 8, 0, 0, 0), 2048, 8)[0]).toMatch(/the width \(2048\) isn't/); // and too big
  });

  it("accepts every allowed size, and non-square pictures", () => {
    for (const side of [8, 16, 32, 64, 128, 256]) expect(ok(solid(side, side, 1, 1, 1), side, side).texture.width).toBe(side);
    expect(ok(solid(64, 8, 1, 1, 1), 64, 8).texture.height).toBe(8);
  });

  it("a texture too big for the DS's texture memory, giving both numbers", () => {
    const [message] = refused(solid(1024, 1024, 0, 0, 0), 1024, 1024);
    expect(message).toContain("2048 KB");
    expect(message).toContain("512 KB");
    expect(refused(solid(1024, 512, 0, 0, 0), 1024, 512)[0]).toContain("1024 KB");
    expect(ok(solid(512, 512, 0, 0, 0), 512, 512).texture.width).toBe(512); // exactly all of it: allowed
  });

  it("no pixels, and data of the wrong length", () => {
    expect(refused(new Uint8Array(0), 0, 0)[0]).toMatch(/no pixels/);
    expect(refused(new Uint8Array(4), 8, 8)[0]).toMatch(/wrong length/);
    expect(refused(solid(8, 8, 0, 0, 0), 8.5, 8)[0]).toMatch(/no pixels/);
  });
});

describe("sizes and encoding helpers", () => {
  it("knows the allowed sizes, their DS size class, and a texture's memory cost", () => {
    expect(TEXTURE_SIZES).toEqual([8, 16, 32, 64, 128, 256, 512, 1024]);
    expect(isTextureSize(64)).toBe(true);
    expect(isTextureSize(48)).toBe(false);
    expect(TEXTURE_SIZES.map(textureSizeClass)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(textureSizeClass(48)).toBe(-1);
    expect(getTextureByteSize({ width: 128, height: 128 })).toBe(32768);
  });

  it("encodes bytes as base64 both ways, including large arrays", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(() => base64ToBytes("not base64 !!")).toThrow();
  });

  it("stores 16-bit values little-endian", () => {
    expect(base64ToBytes(encodeTexels(Uint16Array.of(0x1234, 0xabcd)))).toEqual(Uint8Array.of(0x34, 0x12, 0xcd, 0xab));
  });
});

describe("textures in the rest of the model", () => {
  const small = asTexture(ok(solid(32, 32, 1, 2, 3), 32, 32).texture, "small"); // 2048 bytes
  const big = asTexture(ok(solid(64, 64, 1, 2, 3), 64, 64).texture, "big"); // 8192 bytes

  const meshWith = (name: string, textureId?: string) => {
    const node = createSceneNode({ name, kind: "MeshInstance3D" });
    node.mesh = { primitive: "cube", triangleCount: 12, ...(textureId ? { textureId } : {}) };
    return node;
  };

  it("resolves a mesh's texture, and reports a missing one", () => {
    expect(resolveMeshTexture({ primitive: "cube", triangleCount: 12, textureId: "big" }, [small, big])).toBe(big);
    expect(resolveMeshTexture({ primitive: "cube", triangleCount: 12, textureId: "nope" }, [small, big])).toBeUndefined();
    expect(resolveMeshTexture({ primitive: "cube", triangleCount: 12 }, [small, big])).toBeUndefined();
    expect(resolveMeshTexture({ primitive: "cube", triangleCount: 12, textureId: "big" }, undefined)).toBeUndefined();
  });

  it("counts the memory of the distinct textures in use, once each", () => {
    const scene = createSceneNode({
      name: "Main",
      kind: "Node3D",
      children: [meshWith("a", "big"), meshWith("b", "big"), meshWith("c", "small"), meshWith("d")]
    });
    const budget = computeSceneBudget(scene, undefined, [small, big]);
    expect(budget.textureBytesUsed).toBe(8192 + 2048);
    expect(budget.textureBytesLimit).toBe(524288);
    expect(computeSceneBudget(scene, undefined, []).textureBytesUsed).toBe(0); // a missing texture counts nothing
    expect(computeSceneBudget(createSceneNode({ name: "Main", kind: "Node3D" }), undefined, [small, big]).textureBytesUsed).toBe(0); // unused ones don't count
  });

  it("drops textures no mesh uses when the project is saved, and the key disappears", () => {
    const used = createSceneNode({ name: "Main", kind: "Node3D", children: [meshWith("a", "big")] });
    const project = { ...createProjectSnapshot({ name: "P", mode: "3D", scene: used }), textures: [small, big] };
    expect(withUpdatedScene(project, used).textures?.map((t) => t.id)).toEqual(["big"]);
    const empty = createSceneNode({ name: "Main", kind: "Node3D" });
    expect("textures" in withUpdatedScene(project, empty)).toBe(false);
    expect("textures" in withUpdatedScene(createProjectSnapshot({ name: "P", mode: "3D", scene: empty }), empty)).toBe(false);
  });
});
