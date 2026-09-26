import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import { checkScript, type ScriptCheckResult } from "./index";

/** requirements/scene-designer/STORY.labels-and-text.md: what a script can do to a Label. */

const root = createSceneNode({
  name: "Main",
  kind: "Node3D",
  children: [createSceneNode({ name: "Score", kind: "Label", screen: "top" }), createSceneNode({ name: "Cube", kind: "MeshInstance3D" })]
});
const check = (source: string, attached: Array<{ name: string; kind: "Label" | "MeshInstance3D" }> = [{ name: "Cube", kind: "MeshInstance3D" }]): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("scripts and labels", () => {
  it("sets and reads a label's value (a whole number) and shows and hides it", () => {
    const r = check("var score = 0\n\nfunc _process(delta):\n    score += 1\n    $Score.value = score\n    $Score.value += 5\n    if $Score.value > 10:\n        $Score.visible = false\n");
    expect(errors(r)).toEqual([]);
  });

  it("sets a label's text to text in quotes, and nothing else", () => {
    expect(errors(check('func f():\n    $Score.text = "Game Over"\n'))).toEqual([]);
    expect(errors(check("func f():\n    $Score.text = 5\n"))[0]).toMatch(/text in quotes/);
    expect(errors(check('func f():\n    $Score.text += "x"\n'))[0]).toMatch(/doesn't work on text/);
  });

  it("refuses a float for the value (it counts whole numbers)", () => {
    expect(errors(check("func f():\n    $Score.value = 1.5\n")).length).toBe(1);
  });

  it("says what a node that isn't a label lacks", () => {
    expect(errors(check("func f():\n    $Cube.value = 1\n"))[0]).toMatch(/\$Cube is a MeshInstance3D, which has no "value"/);
    expect(errors(check('func f():\n    $Cube.text = "a"\n'))[0]).toMatch(/no "text"/);
  });

  it("a label can't be moved: it sits on a grid", () => {
    expect(errors(check("func f():\n    $Score.position.x = 5.0\n"))[0]).toMatch(/\$Score is a Label, which has no "position"/);
  });

  it("a script on a label can hide it with visible, and use self.value", () => {
    const r = check("func _process(delta):\n    visible = false\n    self.value = 3\n", [{ name: "Score", kind: "Label" }]);
    expect(errors(r)).toEqual([]);
  });

  it("still lets a script use value and text as its own variable names", () => {
    expect(errors(check("var value = 1\nvar text = 2\n\nfunc f():\n    value += text\n"))).toEqual([]);
  });
});
