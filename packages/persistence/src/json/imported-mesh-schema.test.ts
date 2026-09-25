import { createProjectSnapshot, createSceneNode, parseObj, withUpdatedScene, type ImportedMesh, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

const parsed = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n", { name: "quad" });
if (!parsed.ok) throw new Error("fixture didn't parse");
const model: ImportedMesh = { id: "model-1", ...parsed.mesh };

function projectWithModel(): ProjectSnapshot {
  const user = createSceneNode({ name: "Quad", kind: "MeshInstance3D" });
  user.mesh = { importedMeshId: model.id, triangleCount: 2 };
  const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [user] });
  return { ...createProjectSnapshot({ name: "P", mode: "3D", scene }), meshes: [model] };
}
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

describe("imported meshes in the project file", () => {
  it("leaves a project with no imports unchanged: no meshes key, still valid", () => {
    const plain = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D" }) });
    expect(serializer.serialize(withUpdatedScene(plain, plain.scene))).not.toContain("meshes");
    expect(validator.validate(roundTrip(plain)).valid).toBe(true);
  });

  it("saves and reopens a model and the mesh that uses it, identically", () => {
    const project = projectWithModel();
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(project)));
    expect(reopened.meshes).toEqual([model]);
    expect(reopened.scene.children[0].mesh).toEqual({ importedMeshId: "model-1", triangleCount: 2 });
  });

  it("rejects a mesh that names a model the file doesn't contain, naming the mesh", () => {
    const project = projectWithModel();
    delete project.meshes;
    const issues = issuesOf(roundTrip(project));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Mesh "Quad".*model-1.*isn't in the project file/);
  });

  it("rejects a model whose normals don't match its positions", () => {
    const project = projectWithModel();
    project.meshes = [{ ...model, normals: model.normals.slice(3) }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/one normal for every position/);
  });

  it("rejects indices past the model's vertices, and partial triangles", () => {
    const past = projectWithModel();
    past.meshes = [{ ...model, indices: [0, 1, 99] }];
    expect(issuesOf(roundTrip(past)).join(" ")).toMatch(/vertex the model doesn't have/);
    const partial = projectWithModel();
    partial.meshes = [{ ...model, indices: [0, 1, 2, 3] }];
    expect(issuesOf(roundTrip(partial)).join(" ")).toMatch(/three vertex numbers per triangle/);
  });

  it("rejects duplicate model ids and non-numeric data", () => {
    const dup = projectWithModel();
    dup.meshes = [model, { ...model }];
    expect(issuesOf(roundTrip(dup)).join(" ")).toMatch(/another model already uses/);
    const junk = roundTrip(projectWithModel()) as { meshes: Array<{ positions: unknown[] }> };
    junk.meshes[0].positions[0] = "x";
    expect(validator.validate(junk).valid).toBe(false);
  });

  it("requires a mesh to name a primitive or a model, not both and not neither", () => {
    const both = roundTrip(projectWithModel()) as { scene: { children: Array<{ mesh: Record<string, unknown> }> } };
    both.scene.children[0].mesh.primitive = "cube";
    expect(validator.validate(both).valid).toBe(false);
    const neither = roundTrip(projectWithModel()) as { scene: { children: Array<{ mesh: Record<string, unknown> }> } };
    delete neither.scene.children[0].mesh.importedMeshId;
    expect(validator.validate(neither).valid).toBe(false);
  });

  it("drops an unused model on save", () => {
    const project = projectWithModel();
    const emptyScene = createSceneNode({ name: "Main", kind: "Node3D" });
    expect(serializer.serialize(withUpdatedScene(project, emptyScene))).not.toContain("meshes");
  });
});
