import { createProjectSnapshot, createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function projectWithSkyBox(skyBox?: unknown) {
  const node = createSceneNode({ name: "Sky", kind: "SkyBox3D" });
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [node] }) });
  if (skyBox !== undefined) (project.scene.children[0] as unknown as { skyBox: unknown }).skyBox = skyBox;
  return JSON.parse(serializer.serialize(project));
}

describe("sky box colors in the project file", () => {
  it("accepts a sky box with no colors saved (every project from before it existed, or a brand new one)", () => {
    expect(validator.validate(projectWithSkyBox()).valid).toBe(true);
    expect(validator.validate(projectWithSkyBox({})).valid).toBe(true);
    expect(JSON.stringify(projectWithSkyBox())).not.toContain("topColor");
  });

  it("accepts and round-trips both colors, or just one", () => {
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithSkyBox({ topColor: "#2f6fb0", horizonColor: "#cfe9ff" }))));
    expect(reopened.scene.children[0].skyBox).toEqual({ topColor: "#2f6fb0", horizonColor: "#cfe9ff" });
    const onlyTop = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithSkyBox({ topColor: "#2f6fb0" }))));
    expect(onlyTop.scene.children[0].skyBox).toEqual({ topColor: "#2f6fb0" });
  });

  it("rejects a color that isn't \"#rrggbb\", and unknown fields", () => {
    expect(validator.validate(projectWithSkyBox({ topColor: "blue" })).valid).toBe(false);
    expect(validator.validate(projectWithSkyBox({ topColor: "#fff" })).valid).toBe(false);
    expect(validator.validate(projectWithSkyBox({ topColor: "#2f6fb0", brightness: 2 })).valid).toBe(false);
  });

  it("accepts and round-trips a distance, 0.5..7.5, and rejects one outside that range", () => {
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithSkyBox({ distance: 3 }))));
    expect(reopened.scene.children[0].skyBox).toEqual({ distance: 3 });
    expect(validator.validate(projectWithSkyBox({ distance: 0.5 })).valid).toBe(true);
    expect(validator.validate(projectWithSkyBox({ distance: 7.5 })).valid).toBe(true);
    expect(validator.validate(projectWithSkyBox({ distance: 0.4 })).valid).toBe(false);
    expect(validator.validate(projectWithSkyBox({ distance: 7.6 })).valid).toBe(false);
  });

  it("accepts and round-trips current, alongside colors, and rejects a non-boolean", () => {
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithSkyBox({ topColor: "#2f6fb0", current: true }))));
    expect(reopened.scene.children[0].skyBox).toEqual({ topColor: "#2f6fb0", current: true });
    expect(validator.validate(projectWithSkyBox({ current: false })).valid).toBe(true);
    expect(validator.validate(projectWithSkyBox({ current: "yes" })).valid).toBe(false);
  });
});
