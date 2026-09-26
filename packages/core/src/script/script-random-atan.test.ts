import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import { checkScript, type ScriptCheckResult } from "./index";

/** requirements/scripting/STORY.random-and-atan2.md: randi, randf and atan2 in the checker. */

const root = createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "Cube", kind: "MeshInstance3D" })] });
const check = (source: string): ScriptCheckResult => checkScript(source, { root, attached: [{ name: "Cube", kind: "MeshInstance3D" }] });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("randi, randf and atan2", () => {
  it("randi(n) is a whole number, randf() a float, atan2(y, x) a float", () => {
    const r = check("func f():\n    var a: int = randi(6)\n    var b: float = randf()\n    var c: float = atan2(1.0, position.x)\n    var d = atan2(1, 2)\n");
    expect(errors(r)).toEqual([]);
  });

  it("randi needs one whole number", () => {
    expect(errors(check("func f():\n    var a = randi(2.5)\n"))[0]).toMatch(/whole number/);
    expect(errors(check("func f():\n    var a = randi()\n"))[0]).toMatch(/randi/);
    expect(errors(check("func f():\n    var a: float = randi(3)\n")).length).toBe(0);
  });

  it("randf takes nothing, atan2 takes two numbers", () => {
    expect(errors(check("func f():\n    var a = randf(1)\n"))[0]).toMatch(/randf\(\)/);
    expect(errors(check("func f():\n    var a = atan2(1.0)\n"))[0]).toMatch(/atan2/);
    expect(errors(check("func f():\n    var a = atan2(true, 1.0)\n"))[0]).toMatch(/numbers/);
  });

  it("can't be variable names", () => {
    expect(errors(check("var randi = 1\n"))[0]).toMatch(/built-in name/);
  });
});
