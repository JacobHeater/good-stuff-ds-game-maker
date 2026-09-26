import { computeSceneBudget, createProjectSnapshot, createSceneNode, createTextureFromRgba, textureMemoryLimit, withThreeDScreen, type ImportedTexture, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject, cubeWithSpritesProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.sprites-on-the-2d-screen-of-a-3d-project.md */

const errors = (p: ProjectSnapshot): string[] => translateScene3D(p).diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

describe("sprites on the 2D screen of a 3D project", () => {
  it("are collected, once per image, in hardware order (the node later in the tree first)", () => {
    const { scene, diagnostics } = translateScene3D(cubeWithSpritesProject());
    expect(diagnostics.filter((d) => d.code === "two-d-node-not-built")).toEqual([]);
    const twoD = scene!.sprites2D;
    expect(twoD.images.map((i) => i.label).sort()).toEqual(["diamond", "quadrants", "stripe", "wide"]);
    expect(twoD.sprites.map((s) => s.name)).toEqual(["Stripe", "Wide", "Diamond", "Quad"]);
    expect(twoD.sprites.find((s) => s.name === "Quad")).toMatchObject({ x: 112, y: 80 }); // centered on (128, 96), 32 x 32
  });

  it("a project without sprites has an empty 2D screen, so the runtime keeps all four texture banks", () => {
    const { scene } = translateScene3D(cubeProject());
    expect(scene!.sprites2D).toEqual({ images: [], animations: [], sprites: [], labels: [] });
    expect(writeSceneDataC(scene!)).toMatch(/touchAreas, \{ 0, 0, two_d_images, two_d_sprites, 0, two_d_animations, 0, two_d_labels \}, 0, mesh_frames, mesh_animations\n\};/);
  });

  it("are the same whichever screen the 3D scene is on: they are drawn on the other one", () => {
    const base = cubeWithSpritesProject();
    const swapped: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    expect(translateScene3D(swapped).scene!.sprites2D.sprites).toHaveLength(4);
    expect(translateScene3D(swapped).scene!.screen).toBe("bottom");
  });

  it("are written as constant arrays and referred to by gs_scene", () => {
    const text = writeSceneDataC(translateScene3D(cubeWithSpritesProject()).scene!);
    expect(text).toContain("static const uint8_t two_d_image_0_tiles[]");
    expect(text).toContain("static const GsSprite two_d_sprites[] = {");
    expect(text).toMatch(/touchAreas, \{ 4, 4, two_d_images, two_d_sprites, 0, two_d_animations, 0, two_d_labels \}, 0, mesh_frames, mesh_animations\n\};/);
  });

  it("report the same problems as a 2D project's sprites: a missing image is an error, no image or off the screen only a warning", () => {
    const base = cubeWithSpritesProject();
    const node = (name: string, spriteId?: string, x = 100): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", screen: "bottom", position: { x, y: 50 } }), ...(spriteId ? { spriteId } : {}) });
    const withNodes = (nodes: SceneNode[]): ProjectSnapshot => ({ ...base, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "Sprite2D"), ...nodes] } });
    expect(errors(withNodes([node("Lost", "gone")]))).toEqual(["missing-sprite"]);
    const diagnostics = translateScene3D(withNodes([node("Empty"), node("Away", "spr-diamond", 900)])).diagnostics;
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.code).sort()).toEqual(["sprite-off-screen", "sprite-without-image"]);
  });

  it("still say a TileMap (and the other 2D kinds) isn't drawn yet", () => {
    const base = cubeWithSpritesProject();
    const label = createSceneNode({ name: "Text", kind: "TileMap", screen: "bottom" });
    const { diagnostics } = translateScene3D({ ...base, scene: { ...base.scene, children: [...base.scene.children, label] } });
    expect(diagnostics.filter((d) => d.code === "two-d-node-not-built")).toMatchObject([{ nodeName: "Text" }]);
    expect(diagnostics.find((d) => d.code === "two-d-node-not-built")!.message).toMatch(/only draws Sprite2D, AnimatedSprite2D and Label there so far/);
  });
});

describe("texture memory next to the sprites", () => {
  it("is 512 KB, or 384 KB when the 2D screen has sprites (one 128 KB bank goes to their tiles)", () => {
    expect(textureMemoryLimit(false)).toBe(512 * 1024);
    expect(textureMemoryLimit(true)).toBe(384 * 1024);
  });

  /** A texture of `width` x `height` on a cube of its own, so the scene's textures total that many bytes. */
  function withTextures(sizes: Array<[number, number]>, sprites: boolean): ProjectSnapshot {
    const textures: ImportedTexture[] = sizes.map(([w, h], i) => {
      const made = createTextureFromRgba(new Uint8Array(w * h * 4).fill(200), w, h, { name: `t${i}` });
      if (!made.ok) throw new Error(made.errors.join(" "));
      return { id: `tex-${i}`, ...made.texture };
    });
    const meshes = textures.map((t, i) => ({ ...createSceneNode({ name: `Cube${i}`, kind: "MeshInstance3D", mesh: "cube" }), mesh: { primitive: "cube" as const, triangleCount: 12, textureId: t.id } }));
    const base = cubeProject();
    const kept = base.scene.children.filter((n) => n.kind !== "MeshInstance3D");
    const project: ProjectSnapshot = { ...base, textures, scene: { ...base.scene, children: [...kept, ...meshes] } };
    if (!sprites) return project;
    const withSprites = cubeWithSpritesProject();
    return { ...project, sprites: withSprites.sprites, scene: { ...project.scene, children: [...project.scene.children, ...withSprites.scene.children.filter((n) => n.kind === "Sprite2D")] } };
  }
  // 512 x 256 (256 KB) + 256 x 256 (128 KB) + 8 x 8 (128 bytes) = 384 KB + 128 bytes.
  const SIZES: Array<[number, number]> = [[512, 256], [256, 256], [8, 8]];

  it("textures that fit in 512 KB build without sprites, and are an error with them, saying why", () => {
    expect(errors(withTextures(SIZES, false))).toEqual([]);
    const { diagnostics, scene } = translateScene3D(withTextures(SIZES, true));
    expect(scene).toBeNull();
    expect(diagnostics.find((d) => d.code === "texture-memory")!.message).toMatch(/393344 bytes.*393216 bytes of texture memory.*holds the sprites on the 2D screen/);
  });

  it("textures that fit in 384 KB build with sprites", () => {
    expect(errors(withTextures([[512, 256], [256, 256]], true))).toEqual([]);
  });

  it("the Hardware tab's budget shows the limit the project gets", () => {
    const withSprites = cubeWithSpritesProject();
    const project = createProjectSnapshot({ name: "P", mode: "3D", scene: withSprites.scene });
    expect(computeSceneBudget(project.scene, [], [], [], withSprites.sprites).textureBytesLimit).toBe(384 * 1024);
    expect(computeSceneBudget(project.scene, [], [], [], []).textureBytesLimit).toBe(512 * 1024);
    expect(computeSceneBudget(cubeProject().scene).textureBytesLimit).toBe(512 * 1024);
  });
});
