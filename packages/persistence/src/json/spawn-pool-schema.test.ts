import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));

function projectWithPool(spawnPoolCount: unknown): ProjectSnapshot {
  const node = { ...createSceneNode({ name: "Campfires", kind: "Node2D" }), instanceOf: "campfire" };
  (node as unknown as { spawnPoolCount: unknown }).spawnPoolCount = spawnPoolCount;
  const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
  const other = createSceneNode({ name: "CampfireRoot", kind: "Node2D" });
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sceneId: "s1", scenes: [{ id: "campfire", name: "Campfire", scene: other }] };
}

describe("a spawn-pool node's own spawnPoolCount (STORY.spawn-pools.md)", () => {
  it("an ordinary instance (no spawnPoolCount at all) round-trips unchanged", () => {
    const project = projectWithPool(undefined);
    expect(JSON.stringify(roundTrip(project))).not.toContain("spawnPoolCount");
    expect(validator.validate(roundTrip(project)).valid).toBe(true);
  });

  it("round-trips a pool count within 1..16", () => {
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithPool(8))));
    expect(reopened.scenes![0].scene).toBeDefined(); // the project parses at all
    const poolNode = reopened.scene.children[0];
    expect(poolNode.spawnPoolCount).toBe(8);
  });

  it("rejects a count outside 1..16, and a non-integer", () => {
    expect(validator.validate(roundTrip(projectWithPool(0))).valid).toBe(false);
    expect(validator.validate(roundTrip(projectWithPool(17))).valid).toBe(false);
    expect(validator.validate(roundTrip(projectWithPool(2.5))).valid).toBe(false);
  });
});
