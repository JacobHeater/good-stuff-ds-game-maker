import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import { checkScript } from "./checker";
import { completeScript } from "./completion";

/** requirements/scene-designer/STORY.multiple-scenes.md: change_scene("name") in scripts. */

const root = createSceneNode({ name: "Main", kind: "Node3D" });
const check = (body: string, sceneNames: string[] | undefined = ["Title", "Level1", "Level2"]) =>
  checkScript(`func _process(delta):\n${body}`, { root, attached: [], sceneNames });
const errors = (body: string, names?: string[]) => check(body, names).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("change_scene", () => {
  it("takes the name of one of the project's scenes and resolves it to its place in the project's list", () => {
    expect(errors('    change_scene("Level2")\n')).toEqual([]);
    const result = check('    change_scene("Level2")\n');
    const statement = result.program.functions[0].body[0] as unknown as { expr: { res: unknown } };
    expect(statement.expr.res).toEqual({ kind: "sceneCall", scene: 2 });
  });

  it("can be called under a condition, like any statement", () => {
    expect(errors('    if Input.is_button_pressed("start"):\n        change_scene("Level1")\n')).toEqual([]);
  });

  it("says which scenes exist when the name is wrong", () => {
    expect(errors('    change_scene("Level3")\n')[0]).toMatch(/no scene "Level3".*"Title", "Level1", "Level2"/);
  });

  it("wants the name in quotes, and exactly one argument", () => {
    expect(errors("    change_scene(2)\n")[0]).toMatch(/needs the scene's name in quotes/);
    expect(errors("    change_scene()\n").length).toBeGreaterThan(0);
    expect(errors('    change_scene("Title", "Level1")\n').length).toBeGreaterThan(0);
  });

  it("with the scenes not known (a script not yet checked against a project) takes any name", () => {
    const result = checkScript('func _process(delta):\n    change_scene("Anything")\n', { root, attached: [] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("can't be used as a name for a variable or function", () => {
    const result = checkScript("var change_scene = 1\nfunc _process(delta):\n    pass\n", { root, attached: [] });
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("is offered by auto-complete", () => {
    const source = "func _process(delta):\n    chang";
    const result = completeScript(source, source.length, { root, attached: [] });
    expect(result?.options.map((option) => option.label)).toContain("change_scene");
  });
});
