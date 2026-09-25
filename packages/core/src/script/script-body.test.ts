import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/collision/STORY.solid-shapes-and-move-and-collide.md: move_and_collide, is_on_floor, is_on_wall, is_on_ceiling */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Player", kind: "MeshInstance3D", children: [createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" })] }),
      createSceneNode({ name: "Crate", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" })
    ]
  });
}
type Attached = ScriptSceneContext["attached"];
const withShape: Attached = [{ name: "Player", kind: "MeshInstance3D", hasShape: true }];
const check = (source: string, attached: Attached = withShape, root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const kind = (k: SceneNodeKind, hasShape?: boolean): Attached => [{ name: "It", kind: k, ...(hasShape === undefined ? {} : { hasShape }) }];

describe("move_and_collide and the body state", () => {
  it("accepts a move with three numbers (float or int, expressions too) and the three state questions, on self and by name", () => {
    const r = check(`var velocity = 0.0

func _process(delta):
    var stopped = move_and_collide(1.0 * delta, velocity * delta, 0)
    if is_on_floor() or is_on_wall() or is_on_ceiling():
        velocity = 0.0
    if $Player.is_on_floor():
        $Player.move_and_collide(0.0, -1.0, 0.0)
    if stopped:
        pass
`);
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfMoves).toBe(true);
    expect(r.usage.selfWritesTransform).toBe(true);
    expect(r.usage.nodeMoves.size).toBe(1);
    expect(r.usage.nodeWritesTransform.size).toBe(1);
  });

  it("is a bool, so it can't be used as a number", () => {
    expect(errors(check("func f():\n    var n: int = is_on_floor()\n")).length).toBe(1);
    expect(errors(check("func f() -> bool:\n    return move_and_collide(0.0, 0.0, 0.0)\n"))).toEqual([]);
  });

  it("needs exactly three numbers, and no arguments for the state questions", () => {
    expect(errors(check("func f():\n    move_and_collide(1.0, 2.0)\n"))[0]).toMatch(/move_and_collide\(\) takes 3 arguments, but 2 were given/);
    expect(errors(check("func f():\n    move_and_collide(1.0, 2.0, 3.0, 4.0)\n"))[0]).toMatch(/takes 3 arguments, but 4 were given/);
    expect(errors(check("func f():\n    move_and_collide(true, 0.0, 0.0)\n"))[0]).toMatch(/needs numbers for how far to move on X, Y and Z, not a bool/);
    expect(errors(check("func f():\n    var x = is_on_floor(1)\n"))[0]).toMatch(/is_on_floor\(\) takes 0 arguments, but 1 was given/);
  });

  it("must be called: naming it without parentheses says how", () => {
    expect(errors(check("func f():\n    var x = $Player.is_on_floor\n"))[0]).toMatch(/is_on_floor must be called: is_on_floor\(\)\./);
    expect(errors(check("func f():\n    var x = $Player.move_and_collide\n"))[0]).toMatch(/move_and_collide must be called: move_and_collide\(dx, dy, dz\)\./);
    expect(errors(check("var move_and_collide = 1\n"))[0]).toMatch(/"move_and_collide" is a built-in name/);
  });

  it("needs a collision shape under the node, saying which node has none", () => {
    expect(errors(check("func f():\n    $Crate.move_and_collide(0.0, -1.0, 0.0)\n"))[0]).toMatch(/move_and_collide\(\) needs a node with a collision shape under it, and \$Crate has none\. Add a CollisionShape3D under it\./);
    expect(errors(check("func f():\n    var x = $Crate.is_on_floor()\n"))[0]).toMatch(/is_on_floor\(\) needs a node with a collision shape under it, and \$Crate has none/);
    expect(errors(check("func f():\n    move_and_collide(0.0, -1.0, 0.0)\n", [{ name: "Crate", kind: "MeshInstance3D", hasShape: false }]))[0]).toMatch(
      /this script is attached to Crate, which has none\. Add a CollisionShape3D under it\./
    );
  });

  it("accepts a shape as its own body, and a script that isn't attached yet", () => {
    expect(errors(check("func f():\n    move_and_collide(0.0, -1.0, 0.0)\n", kind("CollisionShape3D", true)))).toEqual([]);
    expect(errors(check("func f():\n    move_and_collide(0.0, -1.0, 0.0)\n", []))).toEqual([]);
    expect(errors(check("func f():\n    move_and_collide(0.0, -1.0, 0.0)\n", kind("MeshInstance3D")))).toEqual([]); // hasShape not known: accepted
  });

  it("is only for 3D nodes with a position: not a sound player", () => {
    expect(errors(check("func f():\n    $Music.move_and_collide(0.0, -1.0, 0.0)\n"))[0]).toMatch(/\$Music is a AudioStreamPlayer, which has no "move_and_collide"/);
  });

  it("has no cascade when the node name is wrong", () => {
    expect(errors(check("func f():\n    $Nobody.move_and_collide(0.0, -1.0, 0.0)\n"))).toEqual(['There is no node named "Nobody" in the scene.']);
  });
});
