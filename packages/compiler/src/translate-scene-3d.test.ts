import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, getPrimitiveTriangleCount, type MeshPrimitive, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { formatDiagnostic, hasErrors } from "./diagnostics";
import { cubeProject, HOUSE_OBJ, importedModelProject, nestedProject, primitivesProject } from "./fixtures";
import { composeTransform, invertAffine, multiply } from "./matrix";
import { writeSceneDataC } from "./scene-data-writer";
import { MAX_DS_LIGHTS, translateScene3D } from "./translate-scene-3d";

const F = 4096;
const asFloats = (m: readonly number[]): number[] => m.map((v) => v / F);

/** Adds children to a copy of a project's root. */
function withChildren(project: ProjectSnapshot, ...extra: SceneNode[]): ProjectSnapshot {
  return { ...project, scene: { ...project.scene, children: [...project.scene.children, ...extra] } };
}
const without = (project: ProjectSnapshot, kind: SceneNode["kind"]): ProjectSnapshot => ({
  ...project,
  scene: { ...project.scene, children: project.scene.children.filter((c) => c.kind !== kind) }
});
const codes = (r: ReturnType<typeof translateScene3D>): string[] => r.diagnostics.map((d) => d.code);

describe("translating a valid 3D project", () => {
  const { scene, diagnostics } = translateScene3D(cubeProject());

  it("produces a scene with no diagnostics", () => {
    expect(diagnostics).toEqual([]);
    expect(scene).not.toBeNull();
  });

  it("lists the mesh, one camera and the light, on a screen, at a frame rate", () => {
    expect(scene!.meshes).toHaveLength(1);
    expect(scene!.lights).toHaveLength(1);
    expect(scene!.screen).toBe("top");
    expect(scene!.fps).toBe(60);
    expect(scene!.camera.view).toHaveLength(16);
  });

  it("honors the frame-rate option", () => {
    expect(translateScene3D(cubeProject(), { fpsTarget: 30 }).scene!.fps).toBe(30);
  });

  it("emits each used primitive once, and only the used ones", () => {
    expect(scene!.primitives.map((p) => p.label)).toEqual(["cube"]);
    const all = translateScene3D(primitivesProject()).scene!;
    expect(all.primitives.map((p) => p.label).sort()).toEqual(["cube", "cylinder", "plane", "sphere"]);
  });

  it("emits the shared geometry: triangle counts and vertex data agree with @goodstuff/core", () => {
    const all = translateScene3D(primitivesProject()).scene!;
    for (const p of all.primitives) {
      expect(p.triangleCount).toBe(getPrimitiveTriangleCount(p.label as MeshPrimitive));
      expect(p.positions).toHaveLength(p.triangleCount * 9);
      expect(p.normals).toHaveLength(p.triangleCount * 3);
    }
  });

  it("keeps every vertex inside the DS's 16-bit range", () => {
    for (const p of translateScene3D(primitivesProject()).scene!.primitives) {
      for (const v of p.positions) {
        expect(v).toBeGreaterThanOrEqual(-32768);
        expect(v).toBeLessThanOrEqual(32767);
      }
    }
  });
});

describe("world transforms are baked through parents", () => {
  const scene = translateScene3D(nestedProject()).scene!;

  it("composes each parent's transform with the mesh's own", () => {
    const rig = composeTransform({ x: -1, y: 0, z: 0 }, { x: 0, y: 90, z: 0 }, { x: 2, y: 2, z: 2 });
    const arm = composeTransform({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 45 }, { x: 1, y: 1, z: 1 });
    const own = composeTransform({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    const expected = multiply(rig, multiply(arm, own));
    const [mesh] = scene.meshes;
    // The DS gets rotation + translation and the scale separately (so normals aren't scaled): together they are the transform.
    const scale = mesh.scale.map((v) => v / F);
    expect(scale.map((v) => +v.toFixed(3))).toEqual([2, 2, 2]);
    const world = asFloats(mesh.world);
    const recomposed = [...world];
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < 3; i++) recomposed[axis * 4 + i] *= scale[axis];
    recomposed.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
    // and the rotation part alone has unit axes
    for (let axis = 0; axis < 3; axis++) expect(Math.hypot(world[axis * 4], world[axis * 4 + 1], world[axis * 4 + 2])).toBeCloseTo(1, 3);
  });

  it("omits everything under a hidden node", () => {
    // The Grandchild cube and the un-nested Marker sphere. The hidden branch's Ghost sphere would make three.
    expect(scene.meshes).toHaveLength(2);
    expect(scene.primitives.map((p) => p.label).sort()).toEqual(["cube", "sphere"]);
  });

  it("a hidden mesh itself is omitted too", () => {
    const project = cubeProject();
    project.scene.children[0].visible = false;
    expect(translateScene3D(project).scene!.meshes).toHaveLength(0);
  });
});

describe("the camera", () => {
  it("is the inverse of its world transform", () => {
    const project = cubeProject();
    const cam = project.scene.children.find((c) => c.kind === "Camera3D")!;
    const world = composeTransform(cam.transform3D!.position, cam.transform3D!.rotation, { x: 1, y: 1, z: 1 });
    const view = translateScene3D(project).scene!.camera.view;
    asFloats(view).forEach((v, i) => expect(v).toBeCloseTo(invertAffine(world)[i], 3));
  });

  it("uses the first camera in the tree and warns about the rest", () => {
    const second = createSceneNode({ name: "Camera2", kind: "Camera3D" });
    const r = translateScene3D(withChildren(cubeProject(), second));
    expect(r.scene).not.toBeNull();
    expect(codes(r)).toEqual(["multiple-cameras"]);
    expect(r.diagnostics[0].nodeName).toBe("Camera");
  });
});

describe("lights", () => {
  it("shine along the node's local -Z, in world space", () => {
    const light = createSceneNode({ name: "L", kind: "DirectionalLight3D", transform3D: { rotation: { x: 0, y: 0, z: 0 } } });
    const r = translateScene3D(withChildren(without(cubeProject(), "DirectionalLight3D"), light));
    const [x, y, z] = r.scene!.lights[0].direction;
    expect([x, y, z]).toEqual([0, 0, -512]); // straight down local -Z
  });

  it("a rotated light's direction follows the rotation", () => {
    const light = createSceneNode({ name: "L", kind: "DirectionalLight3D", transform3D: { rotation: { x: -90, y: 0, z: 0 } } });
    const r = translateScene3D(withChildren(without(cubeProject(), "DirectionalLight3D"), light));
    const [x, y, z] = r.scene!.lights[0].direction;
    expect(x).toBe(0);
    expect(y).toBe(-512); // pitched to shine straight down
    expect(Math.abs(z)).toBeLessThanOrEqual(1);
  });
});

describe("diagnostics", () => {
  it("a missing camera is an error and produces no scene", () => {
    const r = translateScene3D(without(cubeProject(), "Camera3D"));
    expect(r.scene).toBeNull();
    expect(codes(r)).toContain("no-camera");
    expect(hasErrors(r.diagnostics)).toBe(true);
  });

  it("an omni light is a named warning, and the ROM is still built", () => {
    const omni = createSceneNode({ name: "Lamp", kind: "OmniLight3D" });
    const r = translateScene3D(withChildren(cubeProject(), omni));
    expect(r.scene).not.toBeNull();
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "omni-light-skipped", nodeName: "Lamp" })]);
    expect(r.scene!.lights).toHaveLength(1); // the omni light was not added
  });

  it(`more than ${MAX_DS_LIGHTS} directional lights is an error`, () => {
    const lights = Array.from({ length: MAX_DS_LIGHTS }, (_, i) => createSceneNode({ name: `L${i}`, kind: "DirectionalLight3D" }));
    const r = translateScene3D(withChildren(cubeProject(), ...lights)); // the fixture already has one: five total
    expect(r.scene).toBeNull();
    expect(codes(r)).toContain("too-many-lights");
  });

  it("exactly four lights is fine", () => {
    const lights = Array.from({ length: MAX_DS_LIGHTS - 1 }, (_, i) => createSceneNode({ name: `L${i}`, kind: "DirectionalLight3D" }));
    expect(translateScene3D(withChildren(cubeProject(), ...lights)).scene!.lights).toHaveLength(MAX_DS_LIGHTS);
  });

  it("too many triangles is an error that gives the numbers", () => {
    const spheres = Array.from({ length: 20 }, (_, i) => createSceneNode({ name: `S${i}`, kind: "MeshInstance3D", mesh: "sphere" }));
    const r = translateScene3D(withChildren(cubeProject(), ...spheres));
    expect(r.scene).toBeNull();
    const d = r.diagnostics.find((x) => x.code === "over-triangle-budget")!;
    const expected = 12 + 20 * getPrimitiveTriangleCount("sphere");
    expect(d.message).toContain(String(expected));
    expect(d.message).toContain("2048");
  });

  it("the project's 3D screen decides where 3D is drawn, whatever a node's own screen says (the 3D engine drives one screen; the scene root records which)", () => {
    const stray = createSceneNode({ name: "Down", kind: "MeshInstance3D", mesh: "cube", screen: "bottom" });
    const r = translateScene3D(withChildren(cubeProject(), stray));
    expect(hasErrors(r.diagnostics)).toBe(false);
    expect(r.scene!.screen).toBe("top");
  });

  it("a project whose 3D screen is the bottom one compiles to the bottom screen", () => {
    const p = cubeProject();
    p.scene.screen = "bottom";
    expect(translateScene3D(p).scene!.screen).toBe("bottom");
  });

  it("nodes for the 2D screen are saved but not built: a warning names each one (a plain Node2D group needs none), and the 3D still compiles", () => {
    const label = createSceneNode({ name: "Score", kind: "Label", screen: "bottom" });
    const sprite = createSceneNode({ name: "Hero", kind: "Sprite2D", screen: "bottom" });
    const group = createSceneNode({ name: "Hud", kind: "Node2D", screen: "bottom", children: [sprite] });
    const r = translateScene3D(withChildren(cubeProject(), label, group));
    expect(hasErrors(r.diagnostics)).toBe(false);
    expect(r.diagnostics.filter((d) => d.code === "two-d-node-not-built").map((d) => d.nodeName)).toEqual(["Score", "Hero"]);
    expect(r.diagnostics.find((d) => d.nodeName === "Score")!.message).toMatch(/bottom \(2D\) screen.*doesn't draw 2D nodes yet/);
    expect(r.scene!.screen).toBe("top");
  });

  it("a value that doesn't fit the DS's number format is an error naming its node", () => {
    const far = createSceneNode({ name: "Faraway", kind: "MeshInstance3D", mesh: "cube", transform3D: { position: { x: 2 ** 21, y: 0, z: 0 } } });
    const r = translateScene3D(withChildren(cubeProject(), far));
    expect(r.scene).toBeNull();
    expect(r.diagnostics).toEqual([expect.objectContaining({ code: "out-of-range", nodeName: "Faraway" })]);
  });

  it("a 2D project is refused clearly", () => {
    const r = translateScene3D({ ...cubeProject(), mode: "2D" });
    expect(r.scene).toBeNull();
    expect(r.diagnostics[0].message).toMatch(/2D/);
  });

  it("nodes that draw nothing stay quiet", () => {
    // (An AudioStreamPlayer used to be in this list. Audio players now compile, so a player with no sound warns; see sounds.test.ts.)
    // (A CollisionShape3D used to be here too. It compiles now, and one no script checks is warned about; see collision.test.ts.)
    const quiet = [createSceneNode({ name: "Group", kind: "Node3D" })];
    const r = translateScene3D(withChildren(cubeProject(), ...quiet));
    expect(r.diagnostics).toEqual([]);
  });

  it("formats one readable line per diagnostic", () => {
    const line = formatDiagnostic({ severity: "warning", code: "omni-light-skipped", nodeName: "Lamp", message: "left out" });
    expect(line).toBe("Warning [Lamp]: left out");
  });
});

describe("determinism and the generated C", () => {
  it("translating twice gives identical scenes and identical text", () => {
    const a = translateScene3D(primitivesProject()).scene!;
    const b = translateScene3D(primitivesProject()).scene!;
    expect(a).toEqual(b);
    expect(writeSceneDataC(a)).toBe(writeSceneDataC(b));
  });

  it("scene_data.c is data only: no function bodies, no statements", () => {
    const text = writeSceneDataC(translateScene3D(primitivesProject()).scene!);
    expect(text).not.toMatch(/\bif\b|\bfor\b|\bwhile\b|\breturn\b|\(\s*void\s*\)|\{\s*\n\s*[a-z_]+\(/);
    expect(text).toContain("const GsScene gs_scene");
    expect(text).toContain('#include "scene.h"');
  });

  it("emits well-formed C even for a scene with no meshes or lights", () => {
    const p = cubeProject();
    p.scene.children = p.scene.children.filter((c) => c.kind === "Camera3D");
    const text = writeSceneDataC(translateScene3D(p).scene!);
    expect(text).toContain("static const GsMesh meshes[] = {\n  { 0, 0, 0, 0 }\n};");
    expect(text).toContain("static const GsLight lights[] = {\n  { 0, { 0, 0, 0 }, 0 }\n};");
  });
});

describe("the runtime's fallback scene", () => {
  it("is the cube fixture, exactly as the compiler generates it, so the runtime builds on its own and can't drift", () => {
    const committed = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "source", "scene_data.c"), "utf-8");
    expect(committed).toBe(writeSceneDataC(translateScene3D(cubeProject()).scene!));
  });
});

describe("imported models", () => {
  const modelOf = (p: ProjectSnapshot) => p.meshes![0];
  const instance = (p: ProjectSnapshot, name: string): SceneNode => p.scene.children.find((c) => c.name === name)!;

  it("compiles a model to a table with its real triangle count", () => {
    const result = translateScene3D(importedModelProject());
    expect(hasErrors(result.diagnostics)).toBe(false);
    const table = result.scene!.primitives.find((p) => p.label === "house")!;
    expect(table.key).toBe("imported:model-house");
    expect(table.triangleCount).toBe(14);
    expect(table.positions).toHaveLength(14 * 9);
    expect(table.normals).toHaveLength(14 * 3);
  });

  it("shares one table between instances of a model, alongside a primitive's own", () => {
    const scene = translateScene3D(importedModelProject()).scene!;
    expect(scene.primitives.map((p) => p.key).sort()).toEqual(["imported:model-house", "primitive:cube"]);
    expect(scene.meshes).toHaveLength(3);
    const houseTable = scene.primitives.findIndex((p) => p.label === "house");
    expect(scene.meshes.filter((m) => m.primitive === houseTable)).toHaveLength(2);
  });

  it("converts the model's vertices to the DS's fixed-point format", () => {
    const table = translateScene3D(importedModelProject()).scene!.primitives.find((p) => p.label === "house")!;
    const model = modelOf(importedModelProject());
    const first = model.indices[0];
    expect(table.positions.slice(0, 3)).toEqual(model.positions.slice(first * 3, first * 3 + 3).map((v) => Math.round(v * F)));
  });

  it("counts the model's triangles against the frame budget", () => {
    const project = importedModelProject();
    const many = Array.from({ length: 150 }, (_, i) => {
      const n = createSceneNode({ name: `H${i}`, kind: "MeshInstance3D" });
      n.mesh = { importedMeshId: "model-house", triangleCount: 14 };
      return n;
    });
    const result = translateScene3D(withChildren(project, ...many));
    expect(result.scene).toBeNull();
    const diagnostic = result.diagnostics.find((d) => d.code === "over-triangle-budget")!;
    expect(diagnostic.message).toContain(String(14 * 152 + 12)); // 152 houses (2 + 150) and one cube
    expect(diagnostic.message).toContain("2048");
  });

  it("refuses a mesh whose model is missing from the project, naming the node", () => {
    const project = importedModelProject();
    delete project.meshes;
    const result = translateScene3D(project);
    expect(result.scene).toBeNull();
    const missing = result.diagnostics.filter((d) => d.code === "missing-model");
    expect(missing.map((d) => d.nodeName).sort()).toEqual(["House", "Small house"]);
    expect(formatDiagnostic(missing[0])).toMatch(/^Error \[House\]: .*isn't in the project/);
  });

  it("never lets a model's name break out of the generated C comment", () => {
    const project = importedModelProject();
    project.meshes = [{ ...modelOf(project), name: "evil */ int x; /*\nmore" }];
    const c = writeSceneDataC(translateScene3D(project).scene!);
    const comment = c.split("\n").find((line) => line.includes("triangles */") && line.includes("evil"))!;
    expect(comment).toBeDefined();
    expect(comment.match(/\*\//g)).toHaveLength(1); // only the real terminator
    expect(comment.match(/\/\*/g)).toHaveLength(1); // only the real opener
    expect(c).not.toContain("\nmore");
    expect(instance(project, "House").mesh!.importedMeshId).toBe("model-house");
  });

  it("emits byte-identical C for the same project every time", () => {
    const a = writeSceneDataC(translateScene3D(importedModelProject()).scene!);
    const b = writeSceneDataC(translateScene3D(importedModelProject()).scene!);
    expect(a).toBe(b);
  });
});

describe("the house model fixture", () => {
  it("is the same text as tests/prototypes/e2e/models/house.obj, so the file used by the UI test can't drift", () => {
    const file = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "prototypes", "e2e", "models", "house.obj"), "utf-8");
    expect(file.replace(/\r\n/g, "\n")).toBe(HOUSE_OBJ);
  });
});
