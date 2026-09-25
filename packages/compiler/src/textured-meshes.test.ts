import { createSceneNode, createTextureFromRgba, type ImportedTexture, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { formatDiagnostic, hasErrors } from "./diagnostics";
import { cubeProject, quadrantTexture, texturedProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";
import { toT16 } from "./fixed-point";

/** Adds children to a copy of a project's root. */
function withChildren(project: ProjectSnapshot, ...extra: SceneNode[]): ProjectSnapshot {
  return { ...project, scene: { ...project.scene, children: [...project.scene.children, ...extra] } };
}
/** The cube fixture with its cube removed: a camera and a light only. */
function bare(): ProjectSnapshot {
  const p = cubeProject();
  return { ...p, scene: { ...p.scene, children: p.scene.children.filter((c) => c.kind !== "MeshInstance3D") } };
}
function texturedCube(name: string, textureId: string | undefined): SceneNode {
  const node = createSceneNode({ name, kind: "MeshInstance3D" });
  node.mesh = { primitive: "cube", triangleCount: 12, ...(textureId ? { textureId } : {}) };
  return node;
}
function withTextures(p: ProjectSnapshot, textures: ImportedTexture[], ...nodes: SceneNode[]): ProjectSnapshot {
  return { ...withChildren(p, ...nodes), textures };
}
/** A triangle model with the given UVs. */
function triangleModel(uvs?: number[]) {
  return {
    id: "m",
    name: "m",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    ...(uvs ? { uvs } : {}),
    indices: [0, 1, 2]
  };
}
function modelNode(name: string, textureId: string): SceneNode {
  const node = createSceneNode({ name, kind: "MeshInstance3D" });
  node.mesh = { importedMeshId: "m", triangleCount: 1, textureId };
  return node;
}
/** A real 512 x 512 texture: exactly all of the DS's 512 KB of texture memory. */
function wholeMemoryTexture(id: string): ImportedTexture {
  const made = createTextureFromRgba(new Uint8Array(512 * 512 * 4).fill(255), 512, 512, { name: id });
  if (!made.ok) throw new Error("texture didn't convert");
  return { id, ...made.texture };
}

describe("fixed-point texture coordinates", () => {
  it("converts to texels x 16, and refuses what the DS can't hold", () => {
    expect(toT16(0.5, 16)).toBe(128);
    expect(toT16(1, 16)).toBe(256);
    expect(toT16(0, 64)).toBe(0);
    expect(() => toT16(2, 1024)).toThrow(); // 2 * 1024 * 16 = 32768, one past the top
    expect(toT16(1.99, 1024)).toBe(32604);
    expect(() => toT16(300, 16)).toThrow(/t16/);
    expect(Object.is(toT16(-0, 8), -0)).toBe(false);
  });
});

describe("textured meshes", () => {
  it("compiles a textured mesh: the texture, per-vertex coordinates in texels, a white mesh", () => {
    const result = translateScene3D(texturedProject());
    expect(hasErrors(result.diagnostics)).toBe(false);
    const scene = result.scene!;
    expect(scene.textures).toHaveLength(1);
    const [texture] = scene.textures;
    expect(texture).toMatchObject({ key: "texture:quadrants", label: "quadrants", width: 16, height: 16, sizeS: 1, sizeT: 1 });
    expect(texture.texels).toHaveLength(256);
    expect(texture.texels[0]).toBe(0x8000 | 31); // top-left is red
    expect(texture.texels[15]).toBe(0x8000 | (31 << 5)); // top-right is green
    expect(texture.texels[240]).toBe(0x8000 | (31 << 10)); // bottom-left is blue
    expect(texture.texels[255]).toBe(0x8000 | 31 | (31 << 5)); // bottom-right is yellow
    expect(scene.meshes.every((m) => m.texture === 1)).toBe(true);
    expect(scene.meshes.every((m) => m.diffuse === (31 | (31 << 5) | (31 << 10)))).toBe(true);
    for (const table of scene.primitives) {
      expect(table.texcoords).toHaveLength((table.positions.length / 3) * 2);
      expect(table.key).toMatch(/\|texture:quadrants$/);
      expect(table.label).toMatch(/ \+ quadrants$/);
    }
  });

  it("puts texture coordinates in texels: a UV of (0.5, 1) on a 16 x 16 texture is (128, 256)", () => {
    const plane = translateScene3D(texturedProject()).scene!.primitives.find((p) => p.key.startsWith("primitive:plane"))!;
    expect(new Set(plane.texcoords)).toEqual(new Set([0, 256])); // the plane's corners are at 0 or 1, times 16 texels, times 16
    const scene = translateScene3D({ ...withChildren(bare(), modelNode("M", "quadrants")), meshes: [triangleModel([0.5, 1, 0, 0, 1, 0.25])], textures: [quadrantTexture()] }).scene!;
    expect(scene.primitives[0].texcoords).toEqual([128, 256, 0, 0, 256, 64]);
  });

  it("shares one texture and one vertex table between meshes that use them, apart from a plain mesh's", () => {
    const project = withTextures(bare(), [quadrantTexture()], texturedCube("a", "quadrants"), texturedCube("b", "quadrants"), texturedCube("c", "quadrants"), texturedCube("plain", undefined));
    const scene = translateScene3D(project).scene!;
    expect(scene.textures).toHaveLength(1);
    expect(scene.primitives.map((p) => p.key).sort()).toEqual(["primitive:cube", "primitive:cube|texture:quadrants"]);
    expect(scene.meshes.map((m) => m.texture)).toEqual([1, 1, 1, 0]);
    expect(scene.primitives.find((p) => p.key === "primitive:cube")!.texcoords).toBeUndefined();
  });

  it("gives the same geometry with textures of different sizes separate tables that reflect each size", () => {
    const project = withTextures(bare(), [quadrantTexture("small", 16), quadrantTexture("large", 32)], texturedCube("a", "small"), texturedCube("b", "large"));
    const scene = translateScene3D(project).scene!;
    expect(scene.primitives).toHaveLength(2);
    expect(scene.textures.map((t) => t.width)).toEqual([16, 32]);
    expect(Math.max(...scene.primitives[0].texcoords!)).toBe(16 * 16);
    expect(Math.max(...scene.primitives[1].texcoords!)).toBe(32 * 16);
  });

  it("leaves out a texture that only a hidden mesh uses", () => {
    const hidden = createSceneNode({ name: "Hidden", kind: "Node3D", visible: false, children: [texturedCube("ghost", "unused")] });
    const scene = translateScene3D(withTextures(bare(), [quadrantTexture("unused")], hidden, texturedCube("plain", undefined))).scene!;
    expect(scene.textures).toEqual([]);
    expect(scene.primitives).toHaveLength(1);
  });

  it("refuses a mesh whose texture isn't in the project, naming it", () => {
    const result = translateScene3D(withTextures(bare(), [], texturedCube("Lost", "nope")));
    expect(result.scene).toBeNull();
    const d = result.diagnostics.find((x) => x.code === "missing-texture")!;
    expect(formatDiagnostic(d)).toMatch(/^Error \[Lost\]: .*texture that isn't in the project/);
  });

  it("refuses a textured mesh whose model has no UVs, naming it", () => {
    const result = translateScene3D({ ...withChildren(bare(), modelNode("Bare", "quadrants")), meshes: [triangleModel()], textures: [quadrantTexture()] });
    expect(result.scene).toBeNull();
    expect(formatDiagnostic(result.diagnostics.find((x) => x.code === "texture-needs-uvs")!)).toMatch(/^Error \[Bare\]: .*no texture coordinates/);
  });

  it("refuses a UV too far outside the picture for the DS, naming the node, but lets a texture tile a few times", () => {
    // On a 16-wide texture the DS reaches about +-128 in u (2048 texels / 16); 300 can't be held.
    const far = { ...withChildren(bare(), modelNode("Tiled", "quadrants")), meshes: [triangleModel([300, 0, 0, 0, 1, 1])], textures: [quadrantTexture()] };
    const result = translateScene3D(far);
    expect(result.scene).toBeNull();
    const d = result.diagnostics.find((x) => x.code === "out-of-range")!;
    expect(d.nodeName).toBe("Tiled");
    expect(d.message).toMatch(/texture coordinate \(300\)/);
    const tiled = { ...far, meshes: [triangleModel([4, 0, 0, 0, 1, 1])] };
    expect(translateScene3D(tiled).scene).not.toBeNull();
  });

  it("refuses textures that together need more than the DS's texture memory, with the numbers", () => {
    const two = withTextures(bare(), [wholeMemoryTexture("a"), wholeMemoryTexture("b")], texturedCube("x", "a"), texturedCube("y", "b"));
    const result = translateScene3D(two);
    expect(result.scene).toBeNull();
    const d = result.diagnostics.find((x) => x.code === "texture-memory")!;
    expect(d.message).toContain("1048576");
    expect(d.message).toContain("524288");
    // One texture used by two meshes is uploaded once, and is exactly the whole memory: allowed.
    const shared = withTextures(bare(), [wholeMemoryTexture("a")], texturedCube("x", "a"), texturedCube("y", "a"));
    expect(translateScene3D(shared).scene).not.toBeNull();
  });

  it("writes the texture and the coordinates into the C, in hex, deterministically, and a name can't break it", () => {
    const texture: ImportedTexture = { ...quadrantTexture(), name: "evil */ int x; /*" };
    const project = { ...texturedProject(), textures: [texture] };
    const a = writeSceneDataC(translateScene3D(project).scene!);
    expect(a).toBe(writeSceneDataC(translateScene3D(project).scene!));
    expect(a).toContain("static const uint16_t texture_0_texels[] = {");
    expect(a).toContain("0x801f"); // an opaque red texel
    expect(a).toContain("static const GsTexture textures[] = {\n  { 16, 16, 1, 1, texture_0_texels }\n};");
    expect(a).toContain("primitive_0_texcoords");
    const line = a.split("\n").find((l) => l.includes("texture ") && l.includes("evil"))!;
    expect(line.match(/\*\//g)).toHaveLength(1); // only the real terminator
    expect(line.match(/\/\*/g)).toHaveLength(1); // only the real opener
    // A scene with no textures still has a valid one-entry table and a zero count.
    const plain = writeSceneDataC(translateScene3D(cubeProject()).scene!);
    expect(plain).toContain("static const GsTexture textures[] = {\n  { 0, 0, 0, 0, 0 }\n};");
    expect(plain).toMatch(/1, 1, 1, 0, \/\* primitive, mesh, light, texture counts \*\//);
  });
});
