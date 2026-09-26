import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));

/** requirements/scene-designer/STORY.labels-and-text.md: a label's text and color in the project file. */

function withLabel(label: unknown): ProjectSnapshot {
  const node = { ...createSceneNode({ name: "Score", kind: "Label", screen: "top" }), label } as ReturnType<typeof createSceneNode>;
  return createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [node] }) });
}

describe("labels in the project file", () => {
  it("saves and reopens a label's text and color identically", () => {
    const original = withLabel({ text: "HP: {}", color: 1 });
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(original)));
    expect(reopened.scene.children[0].label).toEqual({ text: "HP: {}", color: 1 });
  });

  it("accepts a label that has no settings saved yet (the defaults apply)", () => {
    expect(validator.validate(roundTrip(withLabel(undefined))).valid).toBe(true);
  });

  it("rejects a color that isn't one of the eight, and text longer than a label holds", () => {
    expect(validator.validate(roundTrip(withLabel({ text: "x", color: 8 }))).valid).toBe(false);
    expect(validator.validate(roundTrip(withLabel({ text: "x", color: -1 }))).valid).toBe(false);
    expect(validator.validate(roundTrip(withLabel({ text: "x".repeat(97), color: 1 }))).valid).toBe(false);
  });
});
