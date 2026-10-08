import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function project(): ProjectSnapshot {
  const level = {
    ...createSceneNode({ name: "Level", kind: "TileMap", screen: "top" }),
    tileMap: { spriteId: "tiles", columns: 4, rows: 3, tiles: [0, -1, 1, 1, -1, -1, 0, 0, 0, 0, 0, 0], solid: [false, true] }
  };
  return createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [level] }) });
}
const roundTrip = (p: unknown): unknown => JSON.parse(serializer.serialize(p as ProjectSnapshot));
const issuesOf = (p: unknown): string[] => [...validator.validate(p).issues];

describe("a TileMap's sheet and grid in the project file", () => {
  it("saves and reopens the sheet, grid and solid flags identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(project())));
    expect(reopened.scene.children[0]).toMatchObject({
      kind: "TileMap",
      tileMap: { spriteId: "tiles", columns: 4, rows: 3, tiles: [0, -1, 1, 1, -1, -1, 0, 0, 0, 0, 0, 0], solid: [false, true] }
    });
  });

  it("accepts a TileMap with no sheet saved (defaults apply)", () => {
    const bare = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [createSceneNode({ name: "Level", kind: "TileMap" })] }) });
    expect(validator.validate(roundTrip(bare)).valid).toBe(true);
  });

  it("refuses columns/rows outside 1..32, and a tile index below -1", () => {
    const wide = project();
    (wide.scene.children[0] as { tileMap: Record<string, unknown> }).tileMap.columns = 64;
    expect(issuesOf(roundTrip(wide)).join(" ")).toMatch(/columns/);
    const narrow = project();
    (narrow.scene.children[0] as { tileMap: Record<string, unknown> }).tileMap.rows = 0;
    expect(issuesOf(roundTrip(narrow)).join(" ")).toMatch(/rows/);
    const bad = project();
    (bad.scene.children[0] as { tileMap: Record<string, unknown> }).tileMap.tiles = [-2];
    expect(issuesOf(roundTrip(bad)).length).toBeGreaterThan(0);
  });
});
