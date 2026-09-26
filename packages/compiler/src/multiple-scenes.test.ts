import { createSceneNode, createSpriteFromRgba, DEFAULT_START_SCENE_ID, withSceneEntries, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { checkProject } from "./compile-project";
import { formatDiagnostic } from "./diagnostics";
import { cubeProject, cubeWithSpritesProject } from "./fixtures";
import { writeSceneDataC, writeSceneTableC, writeScriptCodeFileC } from "./scene-data-writer";
import { translateScene2D } from "./translate-scene-2d";
import { translateProject3D } from "./translate-project";

/** requirements/scene-designer/STORY.multiple-scenes.md (the parts that need no toolchain) */

/** A 3D project of scenes made from the cube fixture: each has the cube (with `sources[i]` attached as a script, when there is one) and sprites named for it. */
function project(names: string[], sources: Array<string | undefined>): ProjectSnapshot {
  const base = cubeWithSpritesProject();
  const sceneOf = (name: string, source: string | undefined): SceneNode => ({
    ...base.scene,
    name,
    children: base.scene.children.map((n) => (n.kind === "Sprite2D" ? { ...n, name: `${name}Sprite` } : n.name === "Cube" && source ? { ...n, scriptId: `script-${name}` } : n))
  });
  const entries = names.map((name, i) => ({ id: i === 0 ? DEFAULT_START_SCENE_ID : `id-${name}`, name, scene: sceneOf(name, sources[i]), isStart: i === 0 }));
  const scripts = names.flatMap((name, i) => (sources[i] ? [{ id: `script-${name}`, name: `S${name}`, source: sources[i]! }] : []));
  return { ...withSceneEntries(base, entries), scripts };
}
const NEXT = (name: string): string => `var frames = 0\nfunc _process(delta):\n    frames += 1\n    if frames == 10:\n        change_scene("${name}")\n`;

describe("translating every scene of a project", () => {
  it("gives a project with one scene exactly the one scene it had, with no scene names in the diagnostics", () => {
    const { scenes, diagnostics } = translateProject3D(cubeProject());
    expect(scenes).toHaveLength(1);
    expect(diagnostics.every((d) => d.sceneName === undefined)).toBe(true);
  });

  it("translates each scene on its own, the starting scene first", () => {
    const { scenes, diagnostics } = translateProject3D(project(["First", "Second", "Third"], [NEXT("Second"), NEXT("Third"), undefined]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scenes).toHaveLength(3);
    // each scene draws its own sprites (the name of each was set on its sprite)
    expect(scenes!.map((s) => s.sprites2D.sprites.map((sprite) => sprite.name))).toEqual([["FirstSprite"], ["SecondSprite"], ["ThirdSprite"]].map((names) => expect.arrayContaining(names)));
  });

  it("resolves change_scene to the scene's place in the list, and gives each scene's scripts names of their own", () => {
    const { scenes } = translateProject3D(project(["First", "Second", "Third"], [NEXT("Second"), NEXT("Third"), undefined]));
    expect(scenes![0].scriptCode).toContain("gs_change_scene(1)");
    expect(scenes![1].scriptCode).toContain("gs_change_scene(2)");
    // the first scene's names are plain (as they always were); the others' are prefixed so one file can hold them all
    expect(scenes![0].scriptCode).toContain("gss0_state");
    expect(scenes![0].scriptCode).toContain("const GsScriptInstance gs_script_instances[]");
    expect(scenes![1].scriptCode).toContain("sc1_gss0_state");
    expect(scenes![1].scriptCode).toContain("const GsScriptInstance sc1_gs_script_instances[]");
    expect(scenes![1].scriptCode).not.toMatch(/[^_a-z]gss0_state/);
  });

  it("names a scene that isn't there as an error that says which scene the script is in and which scenes exist", () => {
    const { scenes, diagnostics } = translateProject3D(project(["First", "Second"], [NEXT("Nowhere"), undefined]));
    expect(scenes).toBeNull();
    const error = diagnostics.find((d) => d.severity === "error")!;
    expect(error.sceneName).toBe("First");
    expect(error.message).toMatch(/no scene "Nowhere".*"First", "Second"/);
    expect(formatDiagnostic(error)).toContain("[scene First]");
  });

  it("checks each scene's own limits (a problem in the second scene is reported against it)", () => {
    const p = project(["First", "Second"], [undefined, undefined]);
    p.scenes![0].scene.children = p.scenes![0].scene.children.map((n) => (n.kind === "Sprite2D" ? { ...n, spriteId: "gone" } : n));
    const { diagnostics } = translateProject3D(p);
    const problem = diagnostics.find((d) => d.code === "missing-sprite")!;
    expect(problem.sceneName).toBe("Second");
  });

  it("checkProject sees the errors of every scene", () => {
    expect(checkProject(project(["First", "Second"], [NEXT("Nowhere"), undefined])).some((d) => d.severity === "error")).toBe(true);
    expect(checkProject(project(["First", "Second"], [NEXT("Second"), undefined])).some((d) => d.severity === "error")).toBe(false);
  });
});

describe("the files of a project with several scenes", () => {
  const { scenes } = translateProject3D(project(["First", "Second", "Third"], [NEXT("Second"), NEXT("Third"), undefined]));

  it("writes each scene as gs_scene_data_<n> and a table of them, the starting scene first and current", () => {
    expect(writeSceneDataC(scenes![0], 0)).toContain("const GsScene gs_scene_data_0 = {");
    expect(writeSceneDataC(scenes![2], 2)).toContain("const GsScene gs_scene_data_2 = {");
    const table = writeSceneTableC(3);
    expect(table).toContain("extern const GsScene gs_scene_data_2;");
    expect(table).toContain("  &gs_scene_data_0,\n  &gs_scene_data_1,\n  &gs_scene_data_2\n};");
    expect(table).toContain("const uint16_t gs_scene_table_count = 3;");
    expect(table).toContain("const GsScene *gs_scene_current = &gs_scene_data_0;");
  });

  it("writes every scene's scripts into one file with a table the runtime reads, and a function that resets each scene's variables", () => {
    const text = writeScriptCodeFileC(scenes!);
    expect(text).toContain("const GsSceneScripts gs_scene_scripts[] = {");
    expect(text).toContain("{ gs_script_instances, &gs_script_instance_count, gs_scripts_reset },");
    expect(text).toContain("{ sc1_gs_script_instances, &sc1_gs_script_instance_count, sc1_gs_scripts_reset },");
    expect(text).toContain("{ sc2_gs_script_instances, &sc2_gs_script_instance_count, sc2_gs_scripts_reset }\n};");
    expect(text).toContain("void sc1_gs_scripts_reset(void) {\n\tmemcpy(sc1_gss0_state, sc1_gss0_state_initial, sizeof sc1_gss0_state);\n}");
  });

  it("gives a scene with no scripts an empty table, so the runtime can always read one", () => {
    const text = writeScriptCodeFileC(scenes!);
    expect(text).toContain("const GsScriptInstance sc2_gs_script_instances[] = {\n\t{ 0, 0, 0, 0 }\n};");
    expect(text).toContain("const uint16_t sc2_gs_script_instance_count = 0;");
  });
});

describe("scenes in a 2D project", () => {
  const image = (id: string): ImportedSprite => {
    const made = createSpriteFromRgba(new Uint8Array(16 * 16 * 4).fill(255), 16, 16, { name: id });
    if (!made.ok) throw new Error("didn't convert");
    return { id, ...made.sprite };
  };
  it("puts only the starting scene in the ROM and says so, since a 2D ROM runs no scripts to switch", () => {
    const start = createSceneNode({ name: "Main", kind: "Node2D", children: [{ ...createSceneNode({ name: "A", kind: "Sprite2D", screen: "top", position: { x: 100, y: 50 } }), spriteId: "i" }] });
    const other = createSceneNode({ name: "Other", kind: "Node2D", children: [{ ...createSceneNode({ name: "B", kind: "Sprite2D", screen: "top", position: { x: 50, y: 50 } }), spriteId: "i" }] });
    const base: ProjectSnapshot = { ...cubeProject(), mode: "2D", scene: start, sprites: [image("i")] };
    const p = withSceneEntries(base, [
      { id: DEFAULT_START_SCENE_ID, name: "Main", scene: start, isStart: true },
      { id: "o", name: "Other", scene: other, isStart: false }
    ]);
    const { scene, diagnostics } = translateScene2D(p);
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["A"]);
    expect(diagnostics.map((d) => d.code)).toContain("extra-scenes-not-built");
    expect(diagnostics.find((d) => d.code === "extra-scenes-not-built")!.severity).toBe("warning");
  });
});
