import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/collision/TASK.script-overlaps-check.md */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Player", kind: "MeshInstance3D", children: [createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" })] }),
      createSceneNode({ name: "Coin", kind: "MeshInstance3D", children: [createSceneNode({ name: "CoinShape", kind: "CollisionShape3D" })] }),
      createSceneNode({ name: "Wall Shape", kind: "CollisionShape3D" }),
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

describe("overlaps()", () => {
  it("checks two shapes by name, as a bool", () => {
    const r = check('func _process(delta):\n    if $PlayerShape.overlaps($CoinShape):\n        $Coin.visible = false\n    var touching = $PlayerShape.overlaps($"Wall Shape")\n    if touching and not $CoinShape.overlaps($PlayerShape):\n        pass\n');
    expect(errors(r)).toEqual([]);
    expect(r.usage.nodeOverlaps.size).toBe(3);
    expect(r.usage.selfOverlaps).toBe(false);
    expect(r.usage.referencedNodeIds.size).toBeGreaterThanOrEqual(4);
  });

  it("annotates the call with both nodes, for the code generator", () => {
    const r = check("func _process(delta):\n    if $PlayerShape.overlaps($CoinShape):\n        pass\n");
    const branch = (r.program.functions[0].body[0] as { kind: "if"; branches: Array<{ condition: { res?: unknown } }> }).branches[0];
    expect(branch.condition.res).toMatchObject({ kind: "overlapsCall", a: { kind: "node", name: "PlayerShape" }, b: { kind: "node", name: "CoinShape" } });
  });

  it("works on self for a script attached to a shape, called plainly or with self.", () => {
    const shape = attachedTo("CollisionShape3D");
    const root = scene();
    const r = check("func _process(delta):\n    if overlaps($CoinShape):\n        pass\n    if self.overlaps($CoinShape):\n        pass\n    if $CoinShape.overlaps(self):\n        pass\n", shape, root);
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfOverlaps).toBe(true);
    expect(r.usage.nodeOverlaps).toEqual(new Set([idOf(root, "CoinShape")]));
  });

  it("is an error to name something that isn't a shape, saying what to do", () => {
    const r = check("func _process(delta):\n    if $Coin.overlaps($CoinShape):\n        pass\n    if $PlayerShape.overlaps($Coin):\n        pass\n");
    expect(messages(r)).toEqual([
      "overlaps() works on CollisionShape3D nodes, but $Coin is a MeshInstance3D. Add a CollisionShape3D under it and use that node's name.",
      "overlaps() works on CollisionShape3D nodes, but $Coin is a MeshInstance3D. Add a CollisionShape3D under it and use that node's name."
    ]);
    expect(r.usage.nodeOverlaps.size).toBe(0);
  });

  it("is an error when the script is attached to something that isn't a shape and uses self", () => {
    const r = check("func _process(delta):\n    if overlaps($CoinShape):\n        pass\n", attachedTo("MeshInstance3D"));
    expect(messages(r)[0]).toMatch(/this script is attached to the MeshInstance3D \(a MeshInstance3D\)\. Attach it to a shape, or name one/);
    // With nothing attached yet, self may be anything.
    expect(errors(check("func _process(delta):\n    if overlaps($CoinShape):\n        pass\n", []))).toEqual([]);
  });

  it("needs exactly one node as its argument", () => {
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps(3)\n"))[0]).toMatch(/overlaps\(\) needs the other shape's node/);
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps(true)\n"))[0]).toMatch(/needs the other shape's node/);
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps()\n"))[0]).toMatch(/overlaps\(\) takes 1 argument, but 0 were given/);
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps($CoinShape, $CoinShape)\n"))[0]).toMatch(/takes 1 argument, but 2 were given/);
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps($Missing)\n"))).toEqual(['There is no node named "Missing" in the scene.']);
  });

  it("is a bool, so it can't be used as a number", () => {
    const r = check("func f():\n    var n: int = $PlayerShape.overlaps($CoinShape)\n");
    expect(errors(r).length).toBe(1);
    expect(check("func f() -> bool:\n    return $PlayerShape.overlaps($CoinShape)\n").ok).toBe(true);
  });

  it("must be called, and is a built-in name", () => {
    expect(messages(check("func f():\n    var x = $PlayerShape.overlaps\n"))[0]).toMatch(/overlaps must be called with the other shape/);
    expect(messages(check("var overlaps = 1\n"))[0]).toMatch(/"overlaps" is a built-in name/);
    expect(messages(check("func overlaps():\n    pass\n"))[0]).toMatch(/"overlaps" is a built-in name/);
  });

  it("gives no cascade when the first shape is unknown", () => {
    expect(messages(check("func f():\n    var x = $Missing.overlaps($CoinShape)\n"))).toEqual(['There is no node named "Missing" in the scene.']);
  });
});
