import { createProjectSnapshot, createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function projectWithCamera(camera?: unknown) {
  const node = createSceneNode({ name: "Cam", kind: "Camera3D" });
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [node] }) });
  if (camera !== undefined) (project.scene.children[0] as unknown as { camera: unknown }).camera = camera;
  return JSON.parse(serializer.serialize(project));
}

describe("a Camera3D's far plane in the project file", () => {
  it("accepts a camera with nothing saved (every project from before it existed)", () => {
    expect(validator.validate(projectWithCamera()).valid).toBe(true);
    expect(JSON.stringify(projectWithCamera())).not.toContain("farPlane");
  });

  it("accepts and round-trips values from 5 to 1000, alongside current", () => {
    for (const farPlane of [5, 250, 1000]) {
      const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithCamera({ current: true, farPlane }))));
      expect(reopened.scene.children[0].camera).toEqual({ current: true, farPlane });
    }
  });

  it("rejects a far plane below 5 or above 1000, one that isn't a number, and unknown fields", () => {
    expect(validator.validate(projectWithCamera({ farPlane: 4.9 })).valid).toBe(false);
    expect(validator.validate(projectWithCamera({ farPlane: 1000.1 })).valid).toBe(false);
    expect(validator.validate(projectWithCamera({ farPlane: "far" })).valid).toBe(false);
    expect(validator.validate(projectWithCamera({ farPlane: 100, fogColor: "grey" })).valid).toBe(false);
  });
});
