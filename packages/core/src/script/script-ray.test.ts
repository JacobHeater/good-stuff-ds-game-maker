import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import { checkScript, type ScriptCheckResult } from "./index";

/** requirements/collision/STORY.ray-casts.md: ray_cast in the checker. */

const shape = createSceneNode({ name: "Shape", kind: "CollisionShape3D" });
const root = createSceneNode({
  name: "Main",
  kind: "Node3D",
  children: [createSceneNode({ name: "Player", kind: "MeshInstance3D", children: [shape] }), createSceneNode({ name: "Bare", kind: "MeshInstance3D" })]
});
const check = (source: string, attached = [{ name: "Player", kind: "MeshInstance3D" as const, hasShape: true }]): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("ray_cast", () => {
  it("takes a start, a direction and a reach, and is a float", () => {
    const r = check("func _process(delta):\n    var d: float = ray_cast(position.x, position.y, position.z, 0.0, -1.0, 0.0, 10.0)\n    if d < 0.0:\n        pass\n    if $Player.ray_cast(0, 0, 0, 1, 0, 0, 5) > 2.0:\n        pass\n");
    expect(errors(r)).toEqual([]);
  });

  it("marks the body as used, so the solid shapes are built into the game", () => {
    expect(check("func f():\n    var d = ray_cast(0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 5.0)\n").usage.selfMoves).toBe(true);
  });

  it("wants seven numbers", () => {
    expect(errors(check("func f():\n    var d = ray_cast(0.0, 0.0, 0.0)\n"))[0]).toMatch(/ray_cast\(\)/);
    expect(errors(check("func f():\n    var d = ray_cast(0.0, 0.0, 0.0, 0.0, true, 0.0, 5.0)\n"))[0]).toMatch(/needs numbers/);
  });

  it("needs a node with a collision shape", () => {
    expect(errors(check("func f():\n    var d = $Bare.ray_cast(0, 0, 0, 1, 0, 0, 5)\n"))[0]).toMatch(/needs a node with a collision shape/);
  });

  it("must be called", () => {
    expect(errors(check("func f():\n    var d = $Player.ray_cast\n"))[0]).toMatch(/must be called/);
  });
});
