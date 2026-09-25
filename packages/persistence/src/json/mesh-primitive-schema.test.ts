import { createProjectSnapshot, createSceneNode, MESH_PRIMITIVES } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

/**
 * The JSON Schema is hand-authored and lists the mesh primitives itself, so it can drift from
 * `MESH_PRIMITIVES`. This is the check that catches it: a primitive the editor offers must save and reopen.
 */
describe("mesh primitives in the project file", () => {
  const validator = new JsonSchemaProjectSnapshotValidator();
  const serializer = new JsonProjectSerializer();

  for (const primitive of MESH_PRIMITIVES) {
    it(`a ${primitive} mesh validates and survives a save and reopen`, () => {
      const scene = createSceneNode({
        name: "Main",
        kind: "Node3D",
        children: [createSceneNode({ name: "Thing", kind: "MeshInstance3D", mesh: primitive })]
      });
      const project = createProjectSnapshot({ name: "P", mode: "3D", scene });

      const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(project)));
      expect(reopened.scene.children[0].mesh?.primitive).toBe(primitive);
    });
  }

  it("still rejects a primitive the editor doesn't offer", () => {
    const scene = createSceneNode({
      name: "Main",
      kind: "Node3D",
      children: [createSceneNode({ name: "Thing", kind: "MeshInstance3D" })]
    });
    const project = JSON.parse(serializer.serialize(createProjectSnapshot({ name: "P", mode: "3D", scene })));
    project.scene.children[0].mesh.primitive = "torus";
    expect(validator.validate(project).valid).toBe(false);
  });
});
