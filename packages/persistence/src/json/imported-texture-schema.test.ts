import { createProjectSnapshot, createSceneNode, createTextureFromRgba, withUpdatedScene, type ImportedTexture, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

const picture = new Uint8Array(8 * 8 * 4).fill(200);
const made = createTextureFromRgba(picture, 8, 8, { name: "wall" });
if (!made.ok) throw new Error("fixture didn't convert");
const texture: ImportedTexture = { id: "tex-1", ...made.texture };

function projectWithTexture(): ProjectSnapshot {
  const mesh = createSceneNode({ name: "Cube", kind: "MeshInstance3D" });
  mesh.mesh = { primitive: "cube", triangleCount: 12, textureId: texture.id };
  const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [mesh] });
  return { ...createProjectSnapshot({ name: "P", mode: "3D", scene }), textures: [texture] };
}
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

describe("imported textures in the project file", () => {
  it("leaves a project with no textures unchanged: no textures key, still valid", () => {
    const plain = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D" }) });
    expect(serializer.serialize(withUpdatedScene(plain, plain.scene))).not.toContain("textures");
    expect(validator.validate(roundTrip(plain)).valid).toBe(true);
  });

  it("saves and reopens a texture and the mesh that uses it, identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(projectWithTexture())));
    expect(reopened.textures).toEqual([texture]);
    expect(reopened.scene.children[0].mesh).toEqual({ primitive: "cube", triangleCount: 12, textureId: "tex-1" });
  });

  it("rejects a mesh that names a texture the file doesn't contain, naming the mesh", () => {
    const project = projectWithTexture();
    delete project.textures;
    const issues = issuesOf(roundTrip(project));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Mesh "Cube".*tex-1.*isn't in the project file/);
  });

  it("rejects a size the DS doesn't support", () => {
    const project = projectWithTexture();
    project.textures = [{ ...texture, width: 100 }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/100 x 8, but each side must be one of 8, 16/);
    project.textures = [{ ...texture, width: 2048, height: 8 }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/2048 x 8/);
  });

  it("rejects texel data of the wrong length, or that isn't base64", () => {
    const project = projectWithTexture();
    project.textures = [{ ...texture, texels: texture.texels.slice(0, 40) }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/holds \d+ bytes, but a 8 x 8 texture needs 128/);
    project.textures = [{ ...texture, texels: "not base64!!" }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/isn't valid base64/);
    project.textures = [{ ...texture, texels: "AAA" }]; // length not a multiple of 4
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/isn't valid base64/);
  });

  it("rejects duplicate ids and non-string texels", () => {
    const project = projectWithTexture();
    project.textures = [texture, { ...texture }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/another texture already uses/);
    const junk = roundTrip(projectWithTexture()) as { textures: Array<{ texels: unknown }> };
    junk.textures[0].texels = 42;
    expect(validator.validate(junk).valid).toBe(false);
  });

  it("accepts a mesh with a model and a texture, and rejects a model's UVs of the wrong length", () => {
    const project = projectWithTexture();
    project.meshes = [{ id: "m", name: "m", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], uvs: [0, 1, 1, 1, 0, 0], indices: [0, 1, 2] }];
    project.scene.children[0].mesh = { importedMeshId: "m", triangleCount: 1, textureId: texture.id };
    expect(validator.validate(roundTrip(project)).valid).toBe(true);
    project.meshes[0].uvs = [0, 1];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/uvs must have two numbers for every vertex/);
  });

  it("drops an unused texture on save", () => {
    const project = projectWithTexture();
    const emptyScene = createSceneNode({ name: "Main", kind: "Node3D" });
    expect(serializer.serialize(withUpdatedScene(project, emptyScene))).not.toContain("textures");
  });
});
