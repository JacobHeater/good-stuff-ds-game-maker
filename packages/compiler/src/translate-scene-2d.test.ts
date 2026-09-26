import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { checkProject, compileProject } from "./compile-project";
import { hasErrors } from "./diagnostics";
import { cubeProject, spritesProject } from "./fixtures";
import { toTileOrder, translateScene2D } from "./translate-scene-2d";
import { writeScene2DDataC } from "./scene-data-writer";
import type { RomBuilder } from "./build/rom-builder";


function image(id: string, width: number, height: number, color: [number, number, number] = [200, 50, 50]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

function sprite(name: string, spriteId: string | undefined, screen: "top" | "bottom", x: number, y: number, visible = true): SceneNode {
  const node = createSceneNode({ name, kind: "Sprite2D", screen, position: { x, y }, visible });
  if (spriteId) node.spriteId = spriteId;
  return node;
}

function project2D(children: SceneNode[], sprites: ImportedSprite[]): ProjectSnapshot {
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) }), sprites };
}

describe("translating a 2D project", () => {
  it("refuses a 3D project", () => {
    const { scene, diagnostics } = translateScene2D(cubeProject());
    expect(scene).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["not-a-2d-project"]);
  });

  it("places a sprite by its center, in whole screen pixels", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("A", "s", "top", 100, 50)], [image("s", 32, 16)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.top.sprites).toEqual([{ name: "A", image: 0, x: 84, y: 42, animation: -1, animationFirst: 0, animationCount: 0 }]);
    expect(scene!.bottom.sprites).toEqual([]);
  });

  it("lists sprites in hardware order: the node later in the tree first, since the lowest-numbered sprite is drawn on top", () => {
    const { scene } = translateScene2D(project2D([sprite("Back", "s", "top", 50, 50), sprite("Front", "s", "top", 60, 60)], [image("s", 16, 16)]));
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["Front", "Back"]);
  });

  it("orders nested nodes as a tree, not as a flat list", () => {
    const inner = createSceneNode({ name: "Group", kind: "Node2D", children: [sprite("G1", "s", "top", 10, 10), sprite("G2", "s", "top", 20, 20)] });
    const { scene } = translateScene2D(project2D([sprite("Before", "s", "top", 30, 30), inner, sprite("After", "s", "top", 40, 40)], [image("s", 8, 8)]));
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["After", "G2", "G1", "Before"]);
  });

  it("gives each screen its own copy of an image, and shares one within a screen", () => {
    const { scene } = translateScene2D(project2D([sprite("A", "s", "top", 50, 50), sprite("B", "s", "top", 90, 50), sprite("C", "s", "bottom", 50, 50)], [image("s", 16, 16)]));
    expect(scene!.top.images).toHaveLength(1);
    expect(scene!.bottom.images).toHaveLength(1);
    expect(scene!.top.sprites.map((s) => s.image)).toEqual([0, 0]);
  });

  it("skips a hidden sprite quietly", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("A", "s", "top", 50, 50, false)], [image("s", 8, 8)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.top.sprites).toEqual([]);
  });

  it("warns about a sprite with no image and draws nothing for it", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Empty", undefined, "top", 50, 50)], []));
    expect(scene!.top.sprites).toEqual([]);
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "sprite-without-image", nodeName: "Empty" }]);
  });

  it("errors on an image the project lacks, naming the sprite", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Lost", "gone", "top", 50, 50)], []));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "missing-sprite", nodeName: "Lost" }]);
  });

  it("warns about a sprite entirely off its screen and leaves it out, but keeps one that is partly on", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Gone", "s", "top", 400, 50), sprite("Edge", "s", "top", 2, 50)], [image("s", 16, 16)]));
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "sprite-off-screen", nodeName: "Gone" }]);
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["Edge"]);
    expect(scene!.top.sprites[0].x).toBe(-6);
  });

  it("errors when a screen has more than 128 sprites", () => {
    const many = Array.from({ length: 129 }, (_, i) => sprite(`S${i}`, "s", "top", 100, 100));
    const { diagnostics } = translateScene2D(project2D(many, [image("s", 8, 8)]));
    expect(diagnostics.map((d) => d.code)).toContain("too-many-sprites");
  });

  it("errors when a screen uses more than 16 images (one palette each)", () => {
    const images = Array.from({ length: 17 }, (_, i) => image(`s${i}`, 8, 8, [i * 10, 0, 0]));
    const sprites = images.map((img, i) => sprite(`S${i}`, img.id, "bottom", 100, 100));
    const { diagnostics } = translateScene2D(project2D(sprites, images));
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["too-many-sprite-palettes"]);
    expect(diagnostics[0].message).toMatch(/bottom screen uses 17 different sprite images/);
  });

  it("warns about what the 2D ROM doesn't do yet, and stays quiet about plain groups", () => {
    const script = sprite("Scripted", "s", "top", 50, 50);
    script.scriptId = "x";
    const nodes = [createSceneNode({ name: "Group", kind: "Node2D" }), createSceneNode({ name: "Text", kind: "Label", screen: "top" }), createSceneNode({ name: "Sfx", kind: "AudioStreamPlayer" }), script];
    const { scene, diagnostics } = translateScene2D(project2D(nodes, [image("s", 8, 8)]));
    expect(hasErrors(diagnostics)).toBe(false);
    expect(scene).not.toBeNull();
    expect(diagnostics.map((d) => `${d.code}:${d.nodeName}`).sort()).toEqual(["two-d-node-not-built:Sfx", "two-d-scripts-not-built:Scripted"]);
  });
});

describe("sprite tile order", () => {
  it("puts 8 x 8 tiles left to right then top to bottom, each tile row by row", () => {
    // 16 x 16: pixel value = 100 * tile number + position within the tile is not possible in a byte, so number the quarter instead.
    const pixels = new Uint8Array(16 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pixels[y * 16 + x] = (y >= 8 ? 2 : 0) + (x >= 8 ? 1 : 0);
    const tiles = toTileOrder(pixels, 16, 16);
    expect(tiles).toHaveLength(256);
    expect([tiles[0], tiles[64], tiles[128], tiles[192]]).toEqual([0, 1, 2, 3]);
  });

  it("keeps rows within a tile", () => {
    const pixels = new Uint8Array(8 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) pixels[y * 8 + x] = y * 8 + x; // 8 wide, 16 high: two tiles stacked
    const tiles = toTileOrder(pixels, 8, 16);
    expect(tiles.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // first tile's first row
    expect(tiles[8]).toBe(8); // its second row
    expect(tiles[64]).toBe(64); // the tile below starts with image row 8
  });
});

describe("the 2D data file", () => {
  it("is a pure function of the scene and lists every screen's images and sprites", () => {
    const { scene } = translateScene2D(spritesProject());
    const text = writeScene2DDataC(scene!);
    expect(writeScene2DDataC(scene!)).toBe(text);
    expect(text).toContain('#include "scene2d.h"');
    expect(text).toContain("top_image_0_palette[256]");
    expect(text).toContain("bottom_image_1_tiles");
    expect(text).toContain("const GsScene2D gs_scene2d");
    expect(text).toContain("/* Diamond */");
  });

  it("is valid for a screen with nothing on it (no empty C arrays)", () => {
    const { scene } = translateScene2D(project2D([], []));
    const text = writeScene2DDataC(scene!);
    expect(text).toContain("static const GsSprite top_sprites[] = {\n  { 0, 0, 0, -1, 0, 0 }\n};");
  });
});

describe("compiling by mode", () => {
  const builder = (calls: string[]): RomBuilder =>
    ({
      build: async () => (calls.push("3d"), { ok: true, romPath: "x.nds", output: "" }),
      buildScenes: async () => (calls.push("3d"), { ok: true, romPath: "x.nds", output: "" }),
      build2D: async () => (calls.push("2d"), { ok: true, romPath: "x.nds", output: "" })
    }) as unknown as RomBuilder;

  it("sends a 2D project to the 2D build and a 3D project to the 3D build", async () => {
    const calls: string[] = [];
    await compileProject(spritesProject(), "x.nds", builder(calls));
    await compileProject(cubeProject(), "x.nds", builder(calls));
    expect(calls).toEqual(["2d", "3d"]);
  });

  it("stops before any build when a 2D project has an error", async () => {
    const calls: string[] = [];
    const broken = project2D([sprite("Lost", "gone", "top", 50, 50)], []);
    const result = await compileProject(broken, "x.nds", builder(calls));
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(hasErrors(checkProject(broken))).toBe(true);
    expect(hasErrors(checkProject(spritesProject()))).toBe(false);
  });
});
