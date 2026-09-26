import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { completeScript } from "./completion";
import { checkScript, checkScriptOnNodes, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/touch/TASK.script-touch-area-queries.md */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Cube", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Button", kind: "TouchArea2D", screen: "bottom" }),
      createSceneNode({ name: "Pick", kind: "TouchArea3D" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" })
    ]
  });
}
const attachedTo = (...kinds: SceneNodeKind[]): ScriptSceneContext["attached"] => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached = attachedTo("MeshInstance3D"), root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error");
const messages = (r: ScriptCheckResult): string[] => errors(r).map((d) => d.message);
const idOf = (root: SceneNode, name: string): string => {
  const find = (node: SceneNode): SceneNode | undefined => (node.name === name ? node : node.children.map(find).find(Boolean));
  return find(root)!.id;
};

describe("touch area queries", () => {
  it("asks a TouchArea2D and a TouchArea3D by name, as bools", () => {
    const root = scene();
    const r = check("func _process(delta):\n    if $Button.is_touched():\n        $Cube.visible = false\n    if $Pick.is_touch_pressed() or $Pick.is_touch_released():\n        pass\n    var held = $Button.is_touch_pressed()\n    if held:\n        pass\n", attachedTo("MeshInstance3D"), root);
    expect(errors(r)).toEqual([]);
    expect(r.usage.nodeTouch).toEqual(new Set([idOf(root, "Button"), idOf(root, "Pick")]));
    expect(r.usage.selfTouch).toBe(false);
  });

  it("works on self when the script is attached to a touch area, without $", () => {
    for (const kind of ["TouchArea2D", "TouchArea3D"] as const) {
      const r = check("func _process(delta):\n    if is_touched():\n        pass\n    if self.is_touch_pressed():\n        pass\n    if is_touch_released():\n        pass\n", attachedTo(kind));
      expect(errors(r), kind).toEqual([]);
      expect(r.usage.selfTouch).toBe(true);
    }
  });

  it("annotates the call with the node and which state, for the code generator", () => {
    const r = check("func _process(delta):\n    if $Button.is_touch_pressed():\n        pass\n");
    const branch = (r.program.functions[0].body[0] as { kind: "if"; branches: Array<{ condition: { res?: { kind: string; state: string } } }> }).branches[0];
    expect(branch.condition.res).toMatchObject({ kind: "touchState", state: "pressed" });
  });

  it("refuses a node that is not a touch area, naming what it is", () => {
    expect(messages(check("func _process(delta):\n    if $Cube.is_touched():\n        pass\n"))).toEqual(['$Cube is a MeshInstance3D, which has no "is_touched".']);
    expect(messages(check("func _process(delta):\n    if $Music.is_touch_released():\n        pass\n"))[0]).toMatch(/\$Music is a AudioStreamPlayer/);
    // A script attached to a mesh can't ask about itself.
    expect(messages(check("func _process(delta):\n    if is_touched():\n        pass\n", attachedTo("MeshInstance3D")))[0]).toMatch(/isn't available on the MeshInstance3D/);
  });

  it("wants the parentheses and no arguments", () => {
    expect(messages(check("func _process(delta):\n    var x = $Button.is_touched\n"))[0]).toMatch(/is_touched must be called: is_touched\(\)/);
    expect(messages(check("func _process(delta):\n    var x = $Button.is_touched(1)\n"))[0]).toMatch(/is_touched\(\) takes no arguments|is_touched\(\)/);
  });

  it("reserves the names, so a script's own variable or function can't hide them", () => {
    expect(messages(check("var is_touched = 1\nfunc _process(delta):\n    pass\n"))[0]).toMatch(/built-in name/);
    expect(messages(check("func is_touch_pressed():\n    pass\n"))[0]).toMatch(/built-in name/);
  });

  it("a script on a TouchArea3D can move it like any 3D node", () => {
    const r = check("func _process(delta):\n    position.x += 1.0 * delta\n    if is_touched():\n        visible = false\n", attachedTo("TouchArea3D"));
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfWritesTransform).toBe(true);
  });

  it("a TouchArea2D has no 3D transform to script", () => {
    expect(messages(check("func _process(delta):\n    position.x = 1.0\n", attachedTo("TouchArea2D")))[0]).toMatch(/isn't available on/);
  });
});

describe("touch area auto-complete", () => {
  const complete = (before: string, attached = attachedTo("MeshInstance3D")) => completeScript(before, before.length, { root: scene(), attached })?.options.map((i) => i.label) ?? [];

  it("offers the three queries after a touch area's name, and not after a mesh's", () => {
    const source = "func _process(delta):\n    if $Button.";
    expect(complete(source)).toEqual(expect.arrayContaining(["is_touched", "is_touch_pressed", "is_touch_released"]));
    expect(complete("func _process(delta):\n    if $Cube.")).not.toContain("is_touched");
  });

  it("offers them bare when the script is attached to a touch area", () => {
    expect(complete("func _process(delta):\n    if is", attachedTo("TouchArea3D"))).toEqual(expect.arrayContaining(["is_touched", "is_touch_pressed"]));
    expect(complete("func _process(delta):\n    if is", attachedTo("MeshInstance3D"))).not.toContain("is_touched");
  });
});

describe("copying a whole vector from another node", () => {
  it("$A.position = $B.position is allowed, for position, rotation and scale, and counts as writing the target", () => {
    const root = scene();
    const r = check("func _process(delta):\n    if $Pick.is_touched():\n        $Cube.position = $Pick.position\n        $Cube.rotation = $Pick.rotation\n        $Cube.scale = $Pick.scale\n", attachedTo("MeshInstance3D"), root);
    expect(errors(r)).toEqual([]);
    expect(r.usage.nodeWritesTransform).toEqual(new Set([idOf(root, "Cube")]));
    expect(r.usage.referencedNodeIds.has(idOf(root, "Pick"))).toBe(true);
  });

  it("works on self, bare or with self., and marks the script's own node as written", () => {
    const r = check("func _process(delta):\n    position = $Pick.position\n    self.rotation = $Pick.rotation\n");
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfWritesTransform).toBe(true);
  });

  it("refuses everything else about a whole vector, with a reason", () => {
    expect(messages(check("func _process(delta):\n    $Cube.position += $Pick.position\n"))[0]).toMatch(/doesn't work on a whole vector/);
    expect(messages(check("func _process(delta):\n    $Cube.position = 1.0\n"))[0]).toMatch(/only be set from another node's vector/);
    expect(messages(check("func _process(delta):\n    $Cube.position = $Pick.position.x\n"))[0]).toMatch(/only be set from another node's vector/);
    expect(messages(check("func _process(delta):\n    var x = $Pick.position\n"))[0]).toMatch(/can't be used as a value/);
    expect(messages(check("func _process(delta):\n    $Pick.position = $Button.position\n"))[0]).toMatch(/\$Button is a TouchArea2D, which has no "position"/);
  });
});

describe("Input.touch_ground_x / touch_ground_z", () => {
  it("give a float from a height, and let a script set positions from where the stylus points", () => {
    const r = check("func _process(delta):\n    if $Pick.is_touched():\n        position.x = Input.touch_ground_x(0.0)\n        position.z = Input.touch_ground_z(position.y) + 0.5\n");
    expect(errors(r)).toEqual([]);
  });

  it("wants exactly one number", () => {
    expect(messages(check("func _process(delta):\n    var x = Input.touch_ground_x()\n"))[0]).toMatch(/touch_ground_x/);
    expect(messages(check("func _process(delta):\n    var x = Input.touch_ground_z(1.0, 2.0)\n"))[0]).toMatch(/touch_ground_z/);
    expect(messages(check("func _process(delta):\n    var x = Input.touch_ground_x(true)\n"))[0]).toMatch(/needs the height of the plane as a number/);
  });

  it("is offered by auto-complete after Input.", () => {
    const options = completeScript("func _process(delta):\n    var x = Input.", "func _process(delta):\n    var x = Input.".length, { root: scene(), attached: attachedTo("MeshInstance3D") })?.options.map((o) => o.label) ?? [];
    expect(options).toEqual(expect.arrayContaining(["touch_ground_x", "touch_ground_z"]));
  });
});

describe("$Name relative to the node the script is on", () => {
  /** Two copies of a block, each with its own TouchArea3D called JengaTouch under it, like a duplicated block in the editor. */
  function twoBlocks(): { root: SceneNode; first: SceneNode; second: SceneNode } {
    const block = (name: string): SceneNode => createSceneNode({ name, kind: "MeshInstance3D", children: [createSceneNode({ name: "JengaTouch", kind: "TouchArea3D" })] });
    const first = block("JengaBlock");
    const second = block("JengaBlock2");
    return { root: createSceneNode({ name: "Main", kind: "Node3D", children: [first, second] }), first, second };
  }
  const source = "func _process(delta):\n    if $JengaTouch.is_touched():\n        position.x = 1.0\n";

  it("without a scope the shared child name is ambiguous, as before", () => {
    const { root, first } = twoBlocks();
    expect(messages(checkScript(source, { root, attached: [{ name: first.name, kind: first.kind }] }))[0]).toMatch(/2 nodes are named "JengaTouch"/);
  });

  it("with the block as the scope, $JengaTouch is that block's own child", () => {
    const { root, first, second } = twoBlocks();
    const own = (node: SceneNode): string => node.children[0].id;
    for (const block of [first, second]) {
      const r = checkScript(source, { root, attached: [{ name: block.name, kind: block.kind }], scope: block });
      expect(errors(r)).toEqual([]);
      expect([...r.usage.nodeTouch]).toEqual([own(block)]);
      expect([...r.usage.referencedNodeIds]).toEqual([own(block)]);
    }
  });

  it("falls back to the whole scene for a name that is not under the node, and is ambiguous only when several are under it", () => {
    const { root, first } = twoBlocks();
    const music = createSceneNode({ name: "Music", kind: "AudioStreamPlayer" });
    const scoped = { root: { ...root, children: [...root.children, music] }, attached: [{ name: first.name, kind: first.kind }], scope: first };
    expect(errors(checkScript("func _process(delta):\n    $Music.play()\n", scoped))).toEqual([]);
    const twice = { ...first, children: [...first.children, createSceneNode({ name: "JengaTouch", kind: "TouchArea3D" })] };
    expect(messages(checkScript(source, { root, attached: [{ name: first.name, kind: first.kind }], scope: twice }))[0]).toMatch(/2 nodes under JengaBlock are named "JengaTouch"/);
  });

  it("checkScriptOnNodes checks each copy on its own and reports a shared mistake once", () => {
    const { root, first, second } = twoBlocks();
    const good = checkScriptOnNodes(source, root, [first, second]);
    expect(good.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(good.perNode.map((n) => [...n.result.usage.nodeTouch][0])).toEqual([first.children[0].id, second.children[0].id]);
    const bad = checkScriptOnNodes("func _process(delta):\n    var x = $Nope.position.x\n", root, [first, second]);
    expect(bad.diagnostics.filter((d) => d.severity === "error")).toHaveLength(1);
    expect(checkScriptOnNodes(source, root, []).perNode).toEqual([]);
  });
});
