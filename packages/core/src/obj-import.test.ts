import { describe, expect, it } from "vitest";

import { computeSceneBudget } from "./budget";
import { DS_HARDWARE_PROFILE } from "./hardware";
import { getImportedMeshGeometry, getImportedTriangleCount, MAX_IMPORTED_COORDINATE, type ImportedMesh } from "./imported-mesh";
import { describeMeshSource, meshSourceKey, resolveMeshGeometry } from "./mesh-geometry";
import { parseObj } from "./obj-import";
import { createProjectSnapshot, withUpdatedScene } from "./project-snapshot";
import { createSceneNode } from "./scene-node";

const TRIANGLE = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

function ok(text: string) {
  const result = parseObj(text, { name: "thing" });
  if (!result.ok) throw new Error(`expected success, got: ${result.errors.join(" | ")}`);
  return result;
}
function refused(text: string): string[] {
  const result = parseObj(text, { name: "thing" });
  if (result.ok) throw new Error("expected the import to be refused");
  return result.errors;
}
const triangles = (r: ReturnType<typeof ok>): number => r.mesh.indices.length / 3;

describe("parseObj: what it accepts", () => {
  it("imports a single triangle", () => {
    const r = ok(TRIANGLE);
    expect(r.mesh.name).toBe("thing");
    expect(r.mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(triangles(r)).toBe(1);
    expect(r.mesh.indices).toEqual([0, 1, 2]);
  });

  it("reads all four face vertex formats", () => {
    const text = [
      "v 0 0 0", "v 1 0 0", "v 0 1 0", "vt 0 0", "vn 0 0 1",
      "f 1 2 3",
      "f 1/1 2/1 3/1",
      "f 1//1 2//1 3//1",
      "f 1/1/1 2/1/1 3/1/1"
    ].join("\n");
    const r = ok(text);
    expect(triangles(r)).toBe(4);
    for (let i = 0; i < r.mesh.indices.length; i++) {
      const p = r.mesh.indices[i] * 3;
      expect([r.mesh.positions[p], r.mesh.positions[p + 1]]).toEqual([[0, 0], [1, 0], [0, 1]][i % 3]);
    }
  });

  it("resolves negative (relative) indices against the vertices declared so far", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nv 6 5 5\nv 5 6 5\nf -3 -2 -1\n");
    expect(triangles(r)).toBe(2);
    expect(r.mesh.positions).toContain(6); // the second face used the vertices declared after the first
  });

  it("triangulates quads and larger polygons", () => {
    const quad = ok("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
    expect(triangles(quad)).toBe(2);
    const pentagon = ok("v 0 0 0\nv 2 0 0\nv 3 1 0\nv 1 2 0\nv -1 1 0\nf 1 2 3 4 5\n");
    expect(triangles(pentagon)).toBe(3);
  });

  it("uses the file's normals, normalized", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 5\nf 1//1 2//1 3//1\n");
    expect(r.mesh.normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(r.warnings.join(" ")).not.toMatch(/no normals/);
  });

  it("makes flat normals that agree with the winding when the file has none", () => {
    const ccw = ok(TRIANGLE); // counter-clockwise seen from +Z
    expect(ccw.mesh.normals.slice(0, 3)).toEqual([0, 0, 1]);
    const cw = ok("v 0 0 0\nv 0 1 0\nv 1 0 0\nf 1 2 3\n");
    expect(cw.mesh.normals.slice(0, 3)).toEqual([0, 0, -1]);
    expect(ccw.warnings.join(" ")).toMatch(/no normals/);
  });

  it("falls back to the face normal for a zero-length file normal", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 0\nf 1//1 2//1 3//1\n");
    expect(r.mesh.normals.slice(0, 3)).toEqual([0, 0, 1]);
  });

  it("shares vertices that have the same position and normal, and splits hard edges", () => {
    // A quad on the XY plane: 4 unique vertices shared by 2 triangles.
    const flat = ok("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
    expect(flat.mesh.positions.length / 3).toBe(4);
    // A cube corner: three faces meeting at one position need three distinct normals there.
    const corner = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\n");
    const originCopies = Array.from({ length: corner.mesh.positions.length / 3 }, (_, i) => corner.mesh.positions.slice(i * 3, i * 3 + 3)).filter(
      (p) => p[0] === 0 && p[1] === 0 && p[2] === 0
    );
    expect(originCopies.length).toBe(3);
  });

  it("drops zero-area triangles and says so", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 4\n");
    expect(triangles(r)).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/1 zero-area triangle was dropped/);
  });

  it("names what it ignored", () => {
    const r = ok("mtllib a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nusemtl red\nl 1 2\nf 1 2 3\n");
    const text = r.warnings.join(" ");
    expect(text).toMatch(/Materials/);
    expect(text).toMatch(/Texture coordinates/);
    expect(text).toMatch(/Line and point/);
  });

  it("ignores comments, groups, objects and smoothing silently", () => {
    const r = ok("# a comment\no thing\ng part\ns off\nv 0 0 0 # trailing\nv 1 0 0\nv 0 1 0\nf 1 2 3 # done\n");
    expect(triangles(r)).toBe(1);
    expect(r.warnings.filter((w) => !/no normals/.test(w))).toEqual([]);
  });

  it("ignores a fourth (w) coordinate", () => {
    const r = ok("v 0 0 0 1\nv 1 0 0 1\nv 0 1 0 1\nf 1 2 3\n");
    expect(r.mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("accepts CRLF, tabs and stray spaces the same as a clean file", () => {
    const messy = "v\t0 0   0  \r\nv 1 0 0\r\n\r\n  v 0 1 0\r\nf 1 2 3   \r\n";
    expect(ok(messy).mesh).toEqual(ok(TRIANGLE).mesh);
  });

  it("rounds to five decimals and never writes -0", () => {
    const r = ok("v 0.123456789 -0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
    expect(r.mesh.positions[0]).toBe(0.12346);
    expect(Object.is(r.mesh.positions[1], -0)).toBe(false);
  });

  it("keeps texture coordinates, converted to image space (v flipped)", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n");
    expect(r.mesh.uvs).toEqual([0, 1, 1, 1, 0, 0]); // OBJ's bottom edge (v = 0) is the picture's bottom (v = 1)
    expect(r.mesh.uvs).toHaveLength((r.mesh.positions.length / 3) * 2);
    expect(r.warnings.join(" ")).not.toMatch(/[Tt]exture coordinates/);
  });

  it("reads v/vt/vn faces, a one-number vt, and ignores a third coordinate", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nvt 0.25\nvt 0.5 0.5 0.9\nvt 1 1\nf 1/1/1 2/2/1 3/3/1\n");
    expect(r.mesh.uvs).toEqual([0.25, 1, 0.5, 0.5, 1, 0]);
  });

  it("splits a vertex that has the same position but different texture coordinates", () => {
    // A quad whose two triangles share two corners, but the shared corners get different UVs in each face (a texture seam).
    const seam = ok("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvt 0.5 0.5\nf 1/1 2/2 3/3\nf 1/5 3/3 4/4\n");
    expect(seam.mesh.positions.length / 3).toBe(5); // position 1 appears twice, with two different UVs
    expect(seam.mesh.uvs).toHaveLength(10);
  });

  it("drops texture coordinates the model only partly has, and says so", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\nf 2 4 3\n");
    expect(r.mesh.uvs).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Only some faces have texture coordinates/);
  });

  it("has no UVs, and says why, when the file has vt lines that no face uses", () => {
    const r = ok("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf 1 2 3\n");
    expect(r.mesh.uvs).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/Texture coordinates are in the file but no face uses them/);
  });

  it("falls back to a default name", () => {
    const r = parseObj(TRIANGLE, { name: "   " });
    expect(r.ok && r.mesh.name).toBe("Model");
  });
});

describe("parseObj: what it refuses", () => {
  it("a file with no faces", () => {
    expect(refused("v 0 0 0\nv 1 0 0\n")[0]).toMatch(/no faces/);
    expect(refused("")[0]).toMatch(/no faces/);
  });

  it("a face naming a vertex that doesn't exist, with the line number", () => {
    const errors = refused("v 0 0 0\nv 1 0 0\nf 1 2 3\n");
    expect(errors[0]).toMatch(/^Line 3:.*vertex 3.*only has 2/);
  });

  it("a face naming a normal that doesn't exist", () => {
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1//1 2//1 3//1\n")[0]).toMatch(/normal 1.*only has 0/);
  });

  it("a face naming a texture coordinate that doesn't exist, or a garbage vt", () => {
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf 1/1 2/2 3/1\n")[0]).toMatch(/Line 5.*texture coordinate 2.*only has 1/);
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt abc\nf 1 2 3\n")[0]).toMatch(/Line 4.*texture coordinate needs/);
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf 1/0 2/1 3/1\n")[0]).toMatch(/isn't a valid vertex reference/);
  });

  it("index 0 and garbage indices", () => {
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n")[0]).toMatch(/Line 4/);
    expect(refused("v 0 0 0\nv 1 0 0\nv 0 1 0\nf a b c\n")[0]).toMatch(/isn't a valid vertex reference/);
  });

  it("non-numeric or missing coordinates, and infinities", () => {
    expect(refused("v 0 abc 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")[0]).toMatch(/Line 1.*three numbers/);
    expect(refused("v 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")[0]).toMatch(/three numbers/);
    expect(refused("v 1e999 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")[0]).toMatch(/three numbers/);
  });

  it("a face with fewer than three vertices", () => {
    expect(refused("v 0 0 0\nv 1 0 0\nf 1 2\n")[0]).toMatch(/at least three/);
  });

  it("a model whose faces all have no area", () => {
    expect(refused("v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n")[0]).toMatch(/no area/);
  });

  it("summarizes a flood of errors instead of listing them all", () => {
    const text = Array.from({ length: 50 }, () => "f 1 2 3").join("\n");
    const errors = refused(text);
    expect(errors.length).toBeLessThanOrEqual(9);
    expect(errors.at(-1)).toMatch(/and 42 more/);
  });
});

describe("parseObj: the DS limits", () => {
  const limit = DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame;
  /** n independent unit triangles spread out along X. */
  const many = (n: number): string =>
    Array.from({ length: n }, (_, i) => `v ${i % 7} ${Math.floor(i / 7) % 7} 0\nv ${(i % 7) + 0.5} ${Math.floor(i / 7) % 7} 0\nv ${i % 7} ${(Math.floor(i / 7) % 7) + 0.5} ${1 + Math.floor(i / 49) * 0.01}\nf ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`).join("\n");

  it("refuses more triangles than a frame can draw, giving the count and the limit", () => {
    const [message] = refused(many(limit + 1));
    expect(message).toContain(String(limit + 1));
    expect(message).toContain(String(limit));
  });

  it("accepts exactly the limit", () => {
    expect(triangles(ok(many(limit)))).toBe(limit);
  });

  it("refuses a vertex outside the DS's vertex range, naming its line, and accepts one just inside", () => {
    const errors = refused(`v 0 0 0\nv 9 0 0\nv 0 1 0\nf 1 2 3\n`);
    expect(errors[0]).toMatch(/Line 2.*9.*range/);
    expect(errors[0]).toMatch(/Scale the model down/);
    expect(ok(`v 0 0 0\nv ${MAX_IMPORTED_COORDINATE - 0.001} 0 0\nv 0 1 0\nf 1 2 3\n`)).toBeTruthy();
    expect(refused(`v 0 0 0\nv -${MAX_IMPORTED_COORDINATE + 0.01} 0 0\nv 0 1 0\nf 1 2 3\n`)[0]).toMatch(/range/);
  });

  it("doesn't care about far-away vertices that no face uses", () => {
    expect(triangles(ok(`v 0 0 0\nv 1 0 0\nv 0 1 0\nv 500 500 500\nf 1 2 3\n`))).toBe(1);
  });
});

describe("imported meshes in the rest of the model", () => {
  const parsed = ok("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
  const mesh: ImportedMesh = { id: "m1", ...parsed.mesh };

  it("expands to the same triangle-list shape a primitive has", () => {
    const geometry = getImportedMeshGeometry(mesh);
    expect(geometry.triangleCount).toBe(2);
    expect(geometry.positions).toHaveLength(18);
    expect(geometry.normals).toHaveLength(18);
    expect(getImportedTriangleCount(mesh)).toBe(2);
    expect(getImportedMeshGeometry(mesh)).toBe(geometry); // cached
  });

  it("resolves geometry from a primitive or from the project's models, and reports a missing one", () => {
    const cube = createSceneNode({ name: "c", kind: "MeshInstance3D" });
    expect(resolveMeshGeometry(cube.mesh!, undefined)?.triangleCount).toBe(12);
    const custom = { importedMeshId: "m1", triangleCount: 2 };
    expect(resolveMeshGeometry(custom, [mesh])?.triangleCount).toBe(2);
    expect(resolveMeshGeometry({ importedMeshId: "nope", triangleCount: 2 }, [mesh])).toBeUndefined();
    expect(resolveMeshGeometry({ importedMeshId: "m1", triangleCount: 2 }, undefined)).toBeUndefined();
    expect(resolveMeshGeometry({ triangleCount: 0 }, [mesh])).toBeUndefined();
  });

  it("gives each source its own key and a readable name", () => {
    expect(meshSourceKey({ primitive: "cube", triangleCount: 12 })).toBe("primitive:cube");
    expect(meshSourceKey({ importedMeshId: "m1", triangleCount: 2 })).toBe("imported:m1");
    expect(describeMeshSource({ importedMeshId: "m1", triangleCount: 2 }, [mesh])).toBe("thing");
    expect(describeMeshSource({ importedMeshId: "zz", triangleCount: 2 }, [mesh])).toBe("missing model");
    expect(describeMeshSource({ primitive: "sphere", triangleCount: 168 }, undefined)).toBe("sphere");
  });

  it("is counted by the hardware budget at its real triangle count", () => {
    const scene = createSceneNode({
      name: "Main",
      kind: "Node3D",
      children: [createSceneNode({ name: "a", kind: "MeshInstance3D" }), createSceneNode({ name: "b", kind: "MeshInstance3D" })]
    });
    scene.children[1] = { ...scene.children[1], mesh: { importedMeshId: "m1", triangleCount: 2 } };
    expect(computeSceneBudget(scene, [mesh]).trianglesUsed).toBe(12 + 2);
    expect(computeSceneBudget(scene, []).trianglesUsed).toBe(12); // a missing model counts nothing (the compiler errors)
  });

  it("is dropped from the project when no mesh uses it, and the key disappears", () => {
    const user = { ...createSceneNode({ name: "b", kind: "MeshInstance3D" }), mesh: { importedMeshId: "m1", triangleCount: 2 } };
    const withUser = createSceneNode({ name: "Main", kind: "Node3D", children: [user] });
    const project = { ...createProjectSnapshot({ name: "P", mode: "3D", scene: withUser }), meshes: [mesh, { ...mesh, id: "unused" }] };

    const saved = withUpdatedScene(project, withUser);
    expect(saved.meshes?.map((m) => m.id)).toEqual(["m1"]);

    const empty = createSceneNode({ name: "Main", kind: "Node3D" });
    const cleared = withUpdatedScene(saved, empty);
    expect("meshes" in cleared).toBe(false);

    const plain = createProjectSnapshot({ name: "P", mode: "3D", scene: empty });
    expect("meshes" in withUpdatedScene(plain, empty)).toBe(false);
  });
});
