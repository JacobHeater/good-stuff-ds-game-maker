import { createSceneNode, DEFAULT_START_SCENE_ID, withSceneEntries, type ProjectScript, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { globalSignature, writeScriptCodeFileC } from "./scene-data-writer";
import { translateProject3D } from "./translate-project";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scripting/STORY.game-state-and-save.md (the parts that need no toolchain) */

function withScripts(scripts: ProjectScript[], attach: Record<string, string> = { Cube: scripts[0].id }): ProjectSnapshot {
  const base = cubeProject();
  return {
    ...base,
    scene: { ...base.scene, children: base.scene.children.map((n): SceneNode => (attach[n.name] ? { ...n, scriptId: attach[n.name] } : n)) },
    scripts
  };
}
const script = (id: string, source: string): ProjectScript => ({ id, name: id, source });
const errorsOf = (r: { diagnostics: Array<{ severity: string; message: string }> }) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("global variables in generated code", () => {
  it("live in one table for the game, not in each node's state, and a script that doesn't declare one can use it", () => {
    const a = script("a", "global var score = 0\nglobal var speed = 1.5\n\nfunc _process(delta):\n    score += 1\n    speed = speed * 2.0\n");
    const project = withScripts([a, script("b", "func _process(delta):\n    if score > 3:\n        score = 0\n")], { Cube: "a" });
    const cube = project.scene.children.find((n) => n.name === "Cube")!;
    // a second node with the script b: it doesn't declare score but uses it
    const other = { ...createSceneNode({ name: "Other", kind: "Node3D" }), scriptId: "b" };
    const both: ProjectSnapshot = { ...project, scene: { ...project.scene, children: [...project.scene.children.filter((n) => n !== cube), cube, other] } };
    const { scene, diagnostics } = translateScene3D(both);
    expect(errorsOf({ diagnostics })).toEqual([]);
    // sorted by name: score is 0, speed is 1
    expect(scene!.globals).toEqual([
      { name: "score", type: "int", value: 0 },
      { name: "speed", type: "float", value: 6144 }
    ]);
    expect(scene!.scriptCode).toContain("gs_global[0] = (gs_global[0] + 1);");
    expect(scene!.scriptCode).toContain("gs_global[1]");
    expect(scene!.scriptCode).toMatch(/if \(\(gs_global\[0\] > 3\)\)/);
    expect(scene!.scriptCode).not.toContain("m_score");
  });

  it("are written once, with their starting values and a signature of which there are", () => {
    const { scene } = translateScene3D(withScripts([script("a", "global var lives = 3\nglobal var alive = true\n\nfunc _ready():\n    lives = 2\n")]));
    const text = writeScriptCodeFileC([scene!]);
    expect(text).toContain("int32_t gs_global[2] = { 1, 3 };"); // alive, lives
    expect(text).toContain("const uint16_t gs_global_count = 2;");
    expect(text).toContain(`const uint32_t gs_global_signature = ${globalSignature([{ name: "alive", type: "bool" }, { name: "lives", type: "int" }])}u;`);
  });

  it("have a signature that changes with the names and types, so another game's save isn't loaded", () => {
    const one = globalSignature([{ name: "a", type: "int" }]);
    expect(globalSignature([{ name: "a", type: "int" }])).toBe(one);
    expect(globalSignature([{ name: "b", type: "int" }])).not.toBe(one);
    expect(globalSignature([{ name: "a", type: "float" }])).not.toBe(one);
    expect(globalSignature([])).not.toBe(one);
  });

  it("are the same variables in every scene of a project", () => {
    const level: SceneNode = createSceneNode({ name: "Level2", kind: "Node3D", children: [createSceneNode({ name: "Camera", kind: "Camera3D" }), { ...createSceneNode({ name: "Thing", kind: "Node3D" }), scriptId: "b" }] });
    const base = withScripts([script("a", "global var coins = 5\n\nfunc _ready():\n    coins += 1\n"), script("b", "func _ready():\n    coins += 10\n")]);
    const project = withSceneEntries(base, [
      { id: DEFAULT_START_SCENE_ID, name: "Main", scene: base.scene, isStart: true },
      { id: "l2", name: "Level2", scene: level, isStart: false }
    ]);
    const { scenes, diagnostics } = translateProject3D(project);
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scenes).toHaveLength(2);
    expect(scenes![0].scriptCode).toContain("gs_global[0]");
    expect(scenes![1].scriptCode).toContain("gs_global[0]");
    expect(scenes![1].scriptCode).toContain("sc1_gss");
    expect(scenes![0].globals).toEqual(scenes![1].globals);
    const file = writeScriptCodeFileC(scenes!);
    expect(file.match(/int32_t gs_global\[/g)).toHaveLength(1);
  });

  it("are an error when two scripts declare one differently, but only for a script a node uses", () => {
    const scripts = [script("a", "global var score = 0\n"), script("b", "global var score = 5\n")];
    const used = translateScene3D(withScripts(scripts, { Cube: "a", Sun: "b" }));
    expect(errorsOf(used).join(" ")).toMatch(/"score" is declared in a as int starting at 0, but here as int starting at 5/);
    const unused = translateScene3D(withScripts(scripts, { Cube: "a" }));
    expect(errorsOf(unused)).toEqual([]);
  });

  it("a string global holds its text as-is, read and written as a real pointer (not a save-file-style number)", () => {
    const a = script("a", 'global var title = "Level 1"\n\nfunc _ready():\n    title = "Level 2"\n    var t = title\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.globals).toEqual([{ name: "title", type: "string", value: "Level 1" }]);
    expect(scene!.scriptCode).toContain('gs_global[0] = (int32_t)(intptr_t)"Level 2";');
    expect(scene!.scriptCode).toContain("const char* v_t = ((const char*)(intptr_t)gs_global[0]);");
  });

  it("puts every string global after every numeric one, out of alphabetical order if it has to, so gs_global_count (a save-file boundary) can exclude them all", () => {
    const a = script("a", 'global var alpha = "first"\nglobal var bravo = 2\nglobal var charlie = "second"\nglobal var echo = 1.5\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.globals.map((g) => g.name)).toEqual(["bravo", "echo", "alpha", "charlie"]);
    const text = writeScriptCodeFileC([scene!]);
    expect(text).toContain("const uint16_t gs_global_count = 2;"); // beta, delta: the two numeric ones
    expect(text).toContain('(int32_t)(intptr_t)"first"');
    expect(text).toContain('(int32_t)(intptr_t)"second"');
  });
});

describe("saving in generated code", () => {
  it("compiles save_game(), load_game() and has_save() to the runtime's calls", () => {
    const source = "global var score = 0\n\nfunc _ready():\n    if has_save():\n        load_game()\n    if save_game():\n        score = 1\n";
    const { scene, diagnostics } = translateScene3D(withScripts([script("a", source)]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain("if (gs_has_save()) {");
    expect(scene!.scriptCode).toContain("gs_load_game();");
    expect(scene!.scriptCode).toContain("if (gs_save_game()) {");
  });
});
