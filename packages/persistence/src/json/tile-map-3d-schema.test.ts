import { createProjectSnapshot, createSceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

function projectWithTileMap3D(tileMap3D?: unknown, meshId = "mesh-1") {
  const node = createSceneNode({ name: "Grid", kind: "TileMap3D" });
  if (tileMap3D !== undefined) (node as unknown as { tileMap3D: unknown }).tileMap3D = tileMap3D;
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [node] }) });
  return { ...project, meshes: [{ id: meshId, name: "Stone", positions: [], normals: [], indices: [] }] };
}

describe("TileMap3D in the project file", () => {
  it("accepts a TileMap3D with no palette or cells saved (a brand new one)", () => {
    expect(validator.validate(projectWithTileMap3D()).valid).toBe(true);
    expect(JSON.stringify(projectWithTileMap3D())).not.toContain("tileMap3D");
  });

  it("round-trips a palette and painted cells", () => {
    const tileMap3D = { palette: [{ id: "stone", importedMeshId: "mesh-1" }], cells: { "1,2,3": { paletteId: "stone", rotationY: 2 } } };
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithTileMap3D(tileMap3D))));
    expect(reopened.scene.children[0].tileMap3D).toEqual(tileMap3D);
  });

  it("rejects a palette entry naming a mesh the project doesn't have", () => {
    const tileMap3D = { palette: [{ id: "stone", importedMeshId: "ghost" }], cells: {} };
    const issues = [...validator.validate(projectWithTileMap3D(tileMap3D)).issues];
    expect(issues.join(" ")).toMatch(/palette entry 0.*ghost.*isn't in the project file/);
  });

  it("rejects a cell naming a palette entry that isn't in its own palette", () => {
    const tileMap3D = { palette: [{ id: "stone", importedMeshId: "mesh-1" }], cells: { "0,0,0": { paletteId: "ghost", rotationY: 0 } } };
    const issues = [...validator.validate(projectWithTileMap3D(tileMap3D)).issues];
    expect(issues.join(" ")).toMatch(/paints \(0, 0, 0\).*ghost.*isn't in its own palette/);
  });

  it("rejects a rotationY outside 0..3, and unknown fields", () => {
    expect(validator.validate(projectWithTileMap3D({ palette: [], cells: { "0,0,0": { paletteId: "x", rotationY: 4 } } })).valid).toBe(false);
    expect(validator.validate(projectWithTileMap3D({ palette: [{ id: "a", importedMeshId: "mesh-1", scale: 2 }], cells: {} })).valid).toBe(false);
  });

  it("rejects two palette entries with the same id", () => {
    const tileMap3D = { palette: [{ id: "stone", importedMeshId: "mesh-1" }, { id: "stone", importedMeshId: "mesh-1" }], cells: {} };
    const issues = [...validator.validate(projectWithTileMap3D(tileMap3D)).issues];
    expect(issues.join(" ")).toMatch(/two entries with the id "stone"/);
  });
});
