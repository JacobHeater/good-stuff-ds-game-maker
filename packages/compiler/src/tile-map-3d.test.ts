import { createSceneNode, type ImportedMesh, type TileMap3DData } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

const stoneMesh: ImportedMesh = { id: "stone-mesh", name: "Stone", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };

function grid(tileMap3D: Partial<TileMap3DData>) {
  const node = createSceneNode({ name: "Grid", kind: "TileMap3D" });
  node.tileMap3D = tileMap3D;
  return node;
}

describe("TileMap3D compiles its cells into per-chunk NitroFS files, not C data", () => {
  it("is empty (no tile maps, no palette entries, no chunk files) for a scene with none", () => {
    const scene = translateScene3D(cubeProject()).scene!;
    expect(scene.tileMaps3D).toEqual([]);
    expect(scene.tileMap3DPaletteEntries).toEqual([]);
    expect(scene.tileMap3DChunkFiles).toEqual({});
  });

  it("compiles its palette through the same primitive/texture pipeline a plain mesh uses, and records its own node and palette range", () => {
    const project = cubeProject();
    project.meshes = [stoneMesh];
    project.scene.children.push(grid({ palette: [{ id: "stone", importedMeshId: "stone-mesh" }], cells: { "0,0,0": { paletteId: "stone", rotationY: 0 } } }));
    const scene = translateScene3D(project).scene!;
    expect(scene.tileMaps3D).toHaveLength(1);
    const tileMap = scene.tileMaps3D[0];
    expect(scene.nodes[tileMap.node].name).toBe("Grid");
    expect(tileMap.paletteStart).toBe(0);
    expect(tileMap.paletteCount).toBe(1);
    expect(scene.tileMap3DPaletteEntries).toHaveLength(1);
    const baselinePrimitives = translateScene3D(cubeProject()).scene!.primitives.length;
    expect(scene.primitives).toHaveLength(baselinePrimitives + 1); // the palette's one (new) mesh, compiled once
  });

  it("writes one chunk file per non-empty chunk, named by the tile map's own scene/node index and the chunk's own coordinates", () => {
    const project = cubeProject();
    project.meshes = [stoneMesh];
    project.scene.children.push(grid({ palette: [{ id: "stone", importedMeshId: "stone-mesh" }], cells: { "0,0,0": { paletteId: "stone", rotationY: 0 }, "100,0,0": { paletteId: "stone", rotationY: 1 } } }));
    const scene = translateScene3D(project).scene!;
    const files = Object.keys(scene.tileMap3DChunkFiles);
    expect(files).toHaveLength(2); // two different chunks (0 and 100 are 12+ chunks apart at chunk size 8)
    expect(files).toContain(`${scene.tileMaps3D[0].chunkPathPrefix}0_0_0.bin`);
    expect(files.some((f) => f.startsWith(scene.tileMaps3D[0].chunkPathPrefix))).toBe(true);
  });

  it("packs a chunk as 1 + the palette's own local index (0 = empty) and the cell's rotation, 2 bytes a cell", () => {
    const project = cubeProject();
    project.meshes = [stoneMesh];
    project.scene.children.push(grid({ palette: [{ id: "stone", importedMeshId: "stone-mesh" }], cells: { "1,2,3": { paletteId: "stone", rotationY: 2 } } }));
    const scene = translateScene3D(project).scene!;
    const [path, bytes] = Object.entries(scene.tileMap3DChunkFiles)[0];
    expect(path).toBe(`${scene.tileMaps3D[0].chunkPathPrefix}0_0_0.bin`);
    expect(bytes).toHaveLength(8 * 8 * 8 * 2); // CHUNK_SIZE^3 cells, 2 bytes each
    const cellIndex = 1 + 2 * 8 + 3 * 8 * 8; // local (1, 2, 3) within chunk (0, 0, 0)
    expect(bytes[cellIndex * 2]).toBe(1); // 1 + local palette index 0
    expect(bytes[cellIndex * 2 + 1]).toBe(2); // rotationY
    // Every other cell in the chunk stays 0 (empty).
    expect(bytes.filter((b) => b !== 0)).toHaveLength(2);
  });

  it("reports a palette entry naming a missing model instead of crashing", () => {
    const project = cubeProject();
    project.scene.children.push(grid({ palette: [{ id: "ghost", importedMeshId: "missing" }], cells: { "0,0,0": { paletteId: "ghost", rotationY: 0 } } }));
    const result = translateScene3D(project);
    // An unresolvable palette entry is an error diagnostic, so (like every other "missing-model"-style error in
    // this compiler, e.g. a MeshInstance3D's own missing importedMeshId) the whole scene fails to compile, not
    // just that one entry -- translate-tile-map-3d.ts skips it gracefully rather than throwing, but the error
    // diagnostic it reports still fails the overall compile via hasErrors().
    expect(result.diagnostics.some((d) => d.code === "tile-map-3d-missing-model")).toBe(true);
    expect(result.scene).toBeNull();
  });
});
