import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/scene-designer/STORY.tile-map-3d.md: tile_solid_3d(), TileMap3D's own equivalent of the 2D TileMap's tile_solid(). */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Player", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Level", kind: "TileMap3D" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" })
    ]
  });
}
const attachedTo = (...kinds: SceneNodeKind[]): ScriptSceneContext["attached"] => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached = attachedTo("MeshInstance3D"), root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error");
const messages = (r: ScriptCheckResult): string[] => errors(r).map((d) => d.message);

describe("tile_solid_3d()", () => {
  it("checks a named TileMap3D with three numbers, as a bool", () => {
    const r = check("func _process(delta):\n    if $Level.tile_solid_3d(position.x, position.y - 1.0, position.z):\n        pass\n");
    expect(errors(r)).toEqual([]);
  });

  it("annotates the call with the map, for the code generator", () => {
    const r = check("func _process(delta):\n    if $Level.tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n");
    const branch = (r.program.functions[0].body[0] as { kind: "if"; branches: Array<{ condition: { res?: unknown } }> }).branches[0];
    expect(branch.condition.res).toMatchObject({ kind: "tileSolid3DCall", target: { kind: "node", name: "Level" } });
  });

  it("works on self for a script attached to a TileMap3D, called plainly or with self.", () => {
    const r = check("func _process(delta):\n    if tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n    if self.tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n", attachedTo("TileMap3D"));
    expect(errors(r)).toEqual([]);
  });

  it("is an error to name something that isn't a TileMap3D, saying what to do", () => {
    const r = check("func _process(delta):\n    if $Player.tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n");
    expect(messages(r)).toEqual(["tile_solid_3d() works on a TileMap3D node, but $Player is a MeshInstance3D. Name a TileMap3D instead."]);
  });

  it("is an error when the script is attached to something that isn't a TileMap3D and uses self", () => {
    const r = check("func _process(delta):\n    if tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n", attachedTo("MeshInstance3D"));
    expect(messages(r)[0]).toMatch(/this script is attached to the MeshInstance3D \(a MeshInstance3D\)\. Attach it to a TileMap3D, or name one/);
    // With nothing attached yet, self may be anything.
    expect(errors(check("func _process(delta):\n    if tile_solid_3d(0.0, 0.0, 0.0):\n        pass\n", []))).toEqual([]);
  });

  it("needs exactly three numbers", () => {
    expect(messages(check('func f():\n    var x = $Level.tile_solid_3d("a", 0.0, 0.0)\n'))[0]).toMatch(/tile_solid_3d\(\) needs numbers/);
    expect(messages(check("func f():\n    var x = $Level.tile_solid_3d(0.0, 0.0)\n"))[0]).toMatch(/tile_solid_3d\(\) takes 3 arguments, but 2 were given/);
    expect(messages(check("func f():\n    var x = $Level.tile_solid_3d(0.0, 0.0, 0.0, 0.0)\n"))[0]).toMatch(/takes 3 arguments, but 4 were given/);
  });

  it("is a bool, so it can't be used as a number", () => {
    const r = check("func f():\n    var n: int = $Level.tile_solid_3d(0.0, 0.0, 0.0)\n");
    expect(errors(r).length).toBe(1);
    expect(check("func f() -> bool:\n    return $Level.tile_solid_3d(0.0, 0.0, 0.0)\n").ok).toBe(true);
  });

  it("must be called, and is a built-in name", () => {
    expect(messages(check("func f():\n    var x = $Level.tile_solid_3d\n"))[0]).toMatch(/tile_solid_3d must be called/);
    expect(messages(check("var tile_solid_3d = 1\n"))[0]).toMatch(/"tile_solid_3d" is a built-in name/);
    expect(messages(check("func tile_solid_3d():\n    pass\n"))[0]).toMatch(/"tile_solid_3d" is a built-in name/);
  });

  it("gives no cascade when the map is unknown", () => {
    expect(messages(check("func f():\n    var x = $Missing.tile_solid_3d(0.0, 0.0, 0.0)\n"))).toEqual(['There is no node named "Missing" in the scene.']);
  });
});
