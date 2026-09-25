import { createProjectSnapshot, createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function projectWithLight(light?: unknown) {
  const node = createSceneNode({ name: "Sun", kind: "DirectionalLight3D" });
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [node] }) });
  if (light !== undefined) (project.scene.children[0] as unknown as { light: unknown }).light = light;
  return JSON.parse(serializer.serialize(project));
}

describe("light intensity in the project file", () => {
  it("accepts a light with no intensity saved (every project from before it existed)", () => {
    expect(validator.validate(projectWithLight()).valid).toBe(true);
    expect(JSON.stringify(projectWithLight())).not.toContain("intensity");
  });

  it("accepts and round-trips values from 0 to 1", () => {
    for (const intensity of [0, 0.4, 1]) {
      const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithLight({ intensity }))));
      expect(reopened.scene.children[0].light).toEqual({ intensity });
    }
  });

  it("rejects an intensity below 0 or above 1, one that isn't a number, an empty light, and unknown fields", () => {
    expect(validator.validate(projectWithLight({ intensity: -0.1 })).valid).toBe(false);
    expect(validator.validate(projectWithLight({ intensity: 1.5 })).valid).toBe(false);
    expect(validator.validate(projectWithLight({ intensity: "bright" })).valid).toBe(false);
    expect(validator.validate(projectWithLight({})).valid).toBe(false);
    expect(validator.validate(projectWithLight({ intensity: 0.5, color: "red" })).valid).toBe(false);
  });
});
