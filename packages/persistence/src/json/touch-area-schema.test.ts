import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function project(): ProjectSnapshot {
  const button = { ...createSceneNode({ name: "Button", kind: "TouchArea2D", screen: "bottom", position: { x: 192, y: 48 } }), touchArea2D: { width: 64, height: 48 } };
  const pick = { ...createSceneNode({ name: "Pick", kind: "TouchArea3D" }), touchArea3D: { shape: "sphere" as const, radius: 0.75, size: { x: 1, y: 2, z: 3 } } };
  return createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [button, pick] }) });
}
const roundTrip = (p: unknown): unknown => JSON.parse(serializer.serialize(p as ProjectSnapshot));
const issuesOf = (p: unknown): string[] => [...validator.validate(p).issues];

describe("touch areas in the project file", () => {
  it("saves and reopens both kinds with their settings, identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(project())));
    expect(reopened.scene.children[0]).toMatchObject({ kind: "TouchArea2D", touchArea2D: { width: 64, height: 48 } });
    expect(reopened.scene.children[1]).toMatchObject({ kind: "TouchArea3D", touchArea3D: { shape: "sphere", radius: 0.75, size: { x: 1, y: 2, z: 3 } } });
  });

  it("accepts a touch area with no settings saved (defaults apply)", () => {
    const bare = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [createSceneNode({ name: "B", kind: "TouchArea2D" })] }) });
    expect(validator.validate(roundTrip(bare)).valid).toBe(true);
  });

  it("refuses a rectangle bigger than the screen, an empty one, or an unknown shape", () => {
    const wide = project();
    (wide.scene.children[0] as { touchArea2D: unknown }).touchArea2D = { width: 300, height: 48 };
    expect(issuesOf(roundTrip(wide)).join(" ")).toMatch(/width/);
    (wide.scene.children[0] as { touchArea2D: unknown }).touchArea2D = { width: 0, height: 48 };
    expect(issuesOf(roundTrip(wide)).join(" ")).toMatch(/width/);
    const odd = project();
    (odd.scene.children[1] as { touchArea3D: unknown }).touchArea3D = { shape: "cone" };
    expect(issuesOf(roundTrip(odd)).length).toBeGreaterThan(0);
    (odd.scene.children[1] as { touchArea3D: unknown }).touchArea3D = { radius: -1 };
    expect(issuesOf(roundTrip(odd)).join(" ")).toMatch(/radius/);
  });
});

describe("a sprite's rotation and scale in the project file", () => {
  it("saves and reopens, and refuses a scale beyond the DS's range", () => {
    const sprite = { ...createSceneNode({ name: "S", kind: "Sprite2D" }), transform2D: { rotation: 45, scale: { x: -2, y: 0.5 } } };
    const p = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [sprite] }) });
    expect(validator.assertValid(serializer.deserialize(serializer.serialize(p))).scene.children[0].transform2D).toEqual({ rotation: 45, scale: { x: -2, y: 0.5 } });
    (p.scene.children[0] as { transform2D: unknown }).transform2D = { scale: { x: 50 } };
    expect(issuesOf(roundTrip(p)).join(" ")).toMatch(/scale/);
  });
});
