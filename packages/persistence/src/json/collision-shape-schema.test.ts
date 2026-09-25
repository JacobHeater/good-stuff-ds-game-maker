import { createProjectSnapshot, createSceneNode, getCollisionShape, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function projectWithShape(collision: unknown): ProjectSnapshot {
  const shape = createSceneNode({ name: "Hitbox", kind: "CollisionShape3D" });
  if (collision !== undefined) (shape as { collision?: unknown }).collision = collision;
  return createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [shape] }) });
}
const roundTrip = (project: ProjectSnapshot): ProjectSnapshot => validator.assertValid(serializer.deserialize(serializer.serialize(project)));
const issuesOf = (project: unknown): string[] => [...validator.validate(JSON.parse(JSON.stringify(project))).issues];

describe("collision shapes in the project file", () => {
  it("leaves a node without a shape unchanged: no collision key", () => {
    expect(serializer.serialize(projectWithShape(undefined))).not.toContain('"collision"');
  });

  it("round-trips a capsule, a sphere and a box", () => {
    for (const collision of [
      { shape: "capsule", radius: 0.3, height: 1.4 },
      { shape: "sphere", radius: 2 },
      { shape: "box", size: { x: 1, y: 2, z: 3 } },
      { shape: "cylinder", radius: 0.25, height: 0.5, size: { x: 4, y: 4, z: 4 } },
      { shape: "box", solid: true },
      { solid: false },
      {}
    ]) {
      const reopened = roundTrip(projectWithShape(collision));
      expect(reopened.scene.children[0].collision).toEqual(collision);
    }
  });

  it("reads a saved capsule with the sizes filled in", () => {
    const reopened = roundTrip(projectWithShape({ shape: "capsule", radius: 0.3, height: 1.4 }));
    expect(getCollisionShape(reopened.scene.children[0])).toEqual({ shape: "capsule", size: { x: 1, y: 1, z: 1 }, radius: 0.3, height: 1.4, solid: false });
  });

  it("rejects an unknown shape, an unknown key and sizes out of range", () => {
    expect(issuesOf(projectWithShape({ shape: "cone" })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ shape: "box", colour: "red" })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ radius: 0 })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ radius: -1 })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ height: 5000 })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ size: { x: 0, y: 1, z: 1 } })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ size: { w: 1 } })).length).toBeGreaterThan(0);
    expect(issuesOf(projectWithShape({ solid: "yes" })).length).toBeGreaterThan(0);
  });

  it("names the field that is wrong", () => {
    expect(issuesOf(projectWithShape({ shape: "cone" })).join(" | ")).toMatch(/collision\/shape/);
  });
});
