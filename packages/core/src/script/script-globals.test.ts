import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import { checkScript, collectProjectGlobals, type ScriptCheckResult } from "./index";

/** requirements/scripting/STORY.game-state-and-save.md: global variables and the save file, as the checker sees them. */

const root = createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "Cube", kind: "MeshInstance3D" })] });
const check = (source: string, globals?: Array<{ name: string; type: "int" | "float" | "bool" }>): ScriptCheckResult =>
  checkScript(source, { root, attached: [{ name: "Cube", kind: "MeshInstance3D" }], globals });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("global variables", () => {
  it("are declared with global var, and used by name like any variable", () => {
    const r = check("global var score = 0\nglobal var speed = 1.5\n\nfunc _process(delta):\n    score += 1\n    speed *= 2\n    if score > 10:\n        score = 0\n");
    expect(errors(r)).toEqual([]);
    const use = r.program.functions[0].body[0];
    expect(use.kind === "assign" && use.target.res).toEqual({ kind: "global", name: "score" });
  });

  it("can be used by a script that doesn't declare them, when the project has them", () => {
    const r = check("func _process(delta):\n    score += 1\n", [{ name: "score", type: "int" }]);
    expect(errors(r)).toEqual([]);
    expect(errors(check("func _process(delta):\n    score += 1\n"))[0]).toMatch(/Unknown name "score"/);
  });

  it("keep their type", () => {
    expect(errors(check("global var lives = 3\n\nfunc f():\n    lives = 1.5\n"))[0]).toMatch(/float|whole/i);
    expect(errors(check("global var alive = true\n\nfunc f():\n    alive = 3\n")).length).toBe(1);
  });

  it("can't share a name with a variable of the script, a local or a parameter", () => {
    expect(errors(check("var score = 1\n", [{ name: "score", type: "int" }]))[0]).toMatch(/global variable of the project/);
    expect(errors(check("func f():\n    var score = 1\n", [{ name: "score", type: "int" }]))[0]).toMatch(/already declared/);
    expect(errors(check("func f(score: int):\n    pass\n", [{ name: "score", type: "int" }]))[0]).toMatch(/already declared/);
  });

  it("must be declared with a starting value that is a literal, and once", () => {
    expect(errors(check("global var a = 1 + 2\n"))[0]).toMatch(/initial value must be a number/);
    expect(errors(check("global var a = 1\nglobal var a = 2\n"))[0]).toMatch(/already declared/);
    expect(errors(check("global x = 1\n"))[0]).toMatch(/comes "var"/);
  });

  it("disagree with another script's declaration of the same name when the type differs", () => {
    expect(errors(check("global var score = 1.5\n", [{ name: "score", type: "int" }]))[0]).toMatch(/declared as an int in another script, but a float here/);
  });
});

describe("the project's globals", () => {
  const scripts = [
    { name: "Player", source: "global var score = 0\nglobal var hp = 3\n\nfunc _ready():\n    pass\n" },
    { name: "Enemy", source: "global var score = 0\nglobal var speed = 2.5\nglobal var alive: bool = true\n" }
  ];

  it("are every global var of every script, once each, sorted by name, with their starting values", () => {
    const { globals, problems } = collectProjectGlobals(scripts);
    expect(problems).toEqual([]);
    expect(globals).toEqual([
      { name: "alive", type: "bool", initial: 1 },
      { name: "hp", type: "int", initial: 3 },
      { name: "score", type: "int", initial: 0 },
      { name: "speed", type: "float", initial: 2.5 }
    ]);
  });

  it("say when two scripts disagree on a starting value or a type", () => {
    const { problems } = collectProjectGlobals([...scripts, { name: "Boss", source: "global var score = 100\nglobal var hp = 3.0\n" }]);
    expect(problems.map((p) => p.message).join(" ")).toMatch(/"score" is declared in Player as int starting at 0, but here as int starting at 100/);
    expect(problems.map((p) => p.message).join(" ")).toMatch(/"hp".*as float starting at 3/);
  });

  it("are limited to what the save file holds", () => {
    const many = [{ name: "Big", source: Array.from({ length: 65 }, (_, i) => `global var g${i} = 0`).join("\n") + "\n" }];
    expect(collectProjectGlobals(many).problems[0].message).toMatch(/65 global variables, but a game can have 64/);
  });

  it("leave out scripts without any and negative numbers keep their sign", () => {
    expect(collectProjectGlobals([{ name: "A", source: "var x = 1\n" }]).globals).toEqual([]);
    expect(collectProjectGlobals([{ name: "A", source: "global var t = -2\n" }]).globals).toEqual([{ name: "t", type: "int", initial: -2 }]);
  });
});

describe("saving", () => {
  it("save_game(), load_game() and has_save() are bools taking nothing", () => {
    const r = check("global var score = 0\n\nfunc _ready():\n    if has_save():\n        load_game()\n    if score > 5 and save_game():\n        pass\n");
    expect(errors(r)).toEqual([]);
    expect(errors(check("func f():\n    save_game(1)\n"))[0]).toMatch(/save_game\(\)/);
  });

  it("can't be used as variable names", () => {
    expect(errors(check("var save_game = 1\n"))[0]).toMatch(/built-in name/);
  });
});
