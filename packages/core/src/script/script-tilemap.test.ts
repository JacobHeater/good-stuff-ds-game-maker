import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/scene-designer/STORY.standalone-2d-tilemaps.md */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node2D",
    children: [
      createSceneNode({ name: "Player", kind: "Sprite2D" }),
      createSceneNode({ name: "Level", kind: "TileMap" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" })
    ]
  });
}
const attachedTo = (...kinds: SceneNodeKind[]): ScriptSceneContext["attached"] => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached = attachedTo("Sprite2D"), root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error");
const messages = (r: ScriptCheckResult): string[] => errors(r).map((d) => d.message);

describe("tile_solid()", () => {
  it("checks a named TileMap with two numbers, as a bool", () => {
    const r = check("func _process(delta):\n    if $Level.tile_solid(position.x, position.y + 8.0):\n        position.y -= 1.0\n");
    expect(errors(r)).toEqual([]);
  });

  it("annotates the call with the map, for the code generator", () => {
    const r = check("func _process(delta):\n    if $Level.tile_solid(0.0, 0.0):\n        pass\n");
    const branch = (r.program.functions[0].body[0] as { kind: "if"; branches: Array<{ condition: { res?: unknown } }> }).branches[0];
    expect(branch.condition.res).toMatchObject({ kind: "tileSolidCall", target: { kind: "node", name: "Level" } });
  });

  it("works on self for a script attached to a TileMap, called plainly or with self.", () => {
    const r = check("func _process(delta):\n    if tile_solid(0.0, 0.0):\n        pass\n    if self.tile_solid(0.0, 0.0):\n        pass\n", attachedTo("TileMap"));
    expect(errors(r)).toEqual([]);
  });

  it("is an error to name something that isn't a TileMap, saying what to do", () => {
    const r = check("func _process(delta):\n    if $Player.tile_solid(0.0, 0.0):\n        pass\n");
    expect(messages(r)).toEqual(["tile_solid() works on a TileMap node, but $Player is a Sprite2D. Name a TileMap instead."]);
  });

  it("is an error when the script is attached to something that isn't a TileMap and uses self", () => {
    const r = check("func _process(delta):\n    if tile_solid(0.0, 0.0):\n        pass\n", attachedTo("Sprite2D"));
    expect(messages(r)[0]).toMatch(/this script is attached to the Sprite2D \(a Sprite2D\)\. Attach it to a TileMap, or name one/);
    // With nothing attached yet, self may be anything.
    expect(errors(check("func _process(delta):\n    if tile_solid(0.0, 0.0):\n        pass\n", []))).toEqual([]);
  });

  it("needs exactly two numbers", () => {
    expect(messages(check('func f():\n    var x = $Level.tile_solid("a", 0.0)\n'))[0]).toMatch(/tile_solid\(\) needs numbers/);
    expect(messages(check("func f():\n    var x = $Level.tile_solid(0.0)\n"))[0]).toMatch(/tile_solid\(\) takes 2 arguments, but 1 was given/);
    expect(messages(check("func f():\n    var x = $Level.tile_solid(0.0, 0.0, 0.0)\n"))[0]).toMatch(/takes 2 arguments, but 3 were given/);
  });

  it("is a bool, so it can't be used as a number", () => {
    const r = check("func f():\n    var n: int = $Level.tile_solid(0.0, 0.0)\n");
    expect(errors(r).length).toBe(1);
    expect(check("func f() -> bool:\n    return $Level.tile_solid(0.0, 0.0)\n").ok).toBe(true);
  });

  it("must be called, and is a built-in name", () => {
    expect(messages(check("func f():\n    var x = $Level.tile_solid\n"))[0]).toMatch(/tile_solid must be called/);
    expect(messages(check("var tile_solid = 1\n"))[0]).toMatch(/"tile_solid" is a built-in name/);
    expect(messages(check("func tile_solid():\n    pass\n"))[0]).toMatch(/"tile_solid" is a built-in name/);
  });

  it("gives no cascade when the map is unknown", () => {
    expect(messages(check("func f():\n    var x = $Missing.tile_solid(0.0, 0.0)\n"))).toEqual(['There is no node named "Missing" in the scene.']);
  });
});
