import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode } from "../scene-node";
import { checkScript, type ScriptCheckResult } from "./index";

/** requirements/scene-designer/STORY.spawn-pools.md: spawn("name", x, y, z) / despawn(handle) / is_spawned(handle). */

function scene(): SceneNode {
  return createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "Hero", kind: "MeshInstance3D" })] });
}
const check = (source: string, spawnPools: readonly string[] = ["Campfire", "Rock"], spawnArgCount: 2 | 3 = 3): ScriptCheckResult =>
  checkScript(source, { root: scene(), attached: [{ name: "the Hero", kind: "MeshInstance3D" }], spawnPools, spawnArgCount });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("spawn(name, x, y, z) resolves the pool's own name at compile time", () => {
  it("accepts a known pool name, resolving it to its own place among the project's spawn pools", () => {
    const r = check('func _process(delta):\n    var h = spawn("Campfire", 1.0, 2.0, 3.0)\n    var h2 = spawn("Rock", 0.0, 0.0, 0.0)\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    expect((body[0] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "spawnCall", pool: 0 });
    expect((body[1] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "spawnCall", pool: 1 });
  });

  it("takes a variable or any numeric expression for x, y, z -- not just literals", () => {
    const r = check('func _process(delta):\n    var x = 1.0\n    var h = spawn("Campfire", x, x + 1.0, int(2))\n');
    expect(errors(r)).toEqual([]);
  });

  it("is an error to name a spawn pool the project doesn't have, listing the ones it does", () => {
    expect(errors(check('func f():\n    spawn("Ghost", 0.0, 0.0, 0.0)\n'))).toEqual(['There is no spawn pool "Ghost". Its spawn pools are: "Campfire", "Rock".']);
  });

  it("says so when the project has no spawn pools yet", () => {
    expect(errors(check('func f():\n    spawn("Campfire", 0.0, 0.0, 0.0)\n', []))).toEqual(["This project has no spawn pools yet. Add one in the Inspector."]);
  });

  it("needs the pool's name in quotes, not a variable or number", () => {
    expect(errors(check('func f():\n    var s = "Campfire"\n    spawn(s, 0.0, 0.0, 0.0)\n'))[0]).toMatch(/spawn\(\) needs the pool's name in quotes/);
  });

  it("checks the argument count: 4 total (name, x, y, z) for a 3D project", () => {
    expect(errors(check('func f():\n    spawn("Campfire", 0.0, 0.0)\n'))[0]).toMatch(/spawn\("name", x, y, z\) takes 4 arguments, but 3 were given/);
  });

  it("a 2D project's own spawn() takes only x, y -- 3 arguments total", () => {
    const r2D = check('func f():\n    var h = spawn("Campfire", 1.0, 2.0)\n', ["Campfire"], 2);
    expect(errors(r2D)).toEqual([]);
    expect(errors(check('func f():\n    spawn("Campfire", 1.0, 2.0, 3.0)\n', ["Campfire"], 2))[0]).toMatch(/spawn\("name", x, y\) takes 3 arguments, but 4 were given/);
  });

  it("needs numbers for where to place it", () => {
    expect(errors(check('func f():\n    spawn("Campfire", "a", 0.0, 0.0)\n'))[0]).toMatch(/spawn\(\) needs numbers for where to place it/);
  });

  it("gives an int (the handle), usable in an int context", () => {
    expect(check('func f() -> int:\n    return spawn("Campfire", 0.0, 0.0, 0.0)\n').ok).toBe(true);
  });
});

describe("despawn(handle) / is_spawned(handle)", () => {
  it("accepts an arbitrary int expression for the handle, not just a literal", () => {
    const r = check('func _process(delta):\n    var h = spawn("Campfire", 0.0, 0.0, 0.0)\n    if is_spawned(h):\n        despawn(h)\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    const ifStmt = body[1] as { kind: "if"; branches: Array<{ condition: { res?: unknown }; body: Array<{ kind: "expr"; expr: { res?: unknown } }> }> };
    expect(ifStmt.branches[0].condition.res).toMatchObject({ kind: "despawnCall", method: "is_spawned" });
    expect(ifStmt.branches[0].body[0].expr.res).toMatchObject({ kind: "despawnCall", method: "despawn" });
  });

  it("checks the argument count and rejects a non-int handle", () => {
    expect(errors(check("func f():\n    despawn()\n"))[0]).toMatch(/despawn\(handle\) takes 1 argument, but 0 were given/);
    expect(errors(check('func f():\n    despawn("a")\n'))[0]).toMatch(/can't be used as an int|An int can't/);
  });

  it("is_spawned() gives a bool; despawn() gives no value at all", () => {
    expect(check('func f() -> bool:\n    return is_spawned(spawn("Campfire", 0.0, 0.0, 0.0))\n').ok).toBe(true);
    expect(errors(check('func f():\n    var x = despawn(spawn("Campfire", 0.0, 0.0, 0.0))\n'))[0]).toMatch(/This call doesn't give a value\./);
  });

  it("must be called, and all three names are built-in (can't be a variable or function)", () => {
    expect(errors(check("func f():\n    var x = spawn\n"))[0]).toMatch(/"spawn" is a function; call it with parentheses/);
    expect(errors(check("func f():\n    var x = despawn\n"))[0]).toMatch(/"despawn" is a function; call it with parentheses/);
    expect(errors(check("var spawn = 1\n"))[0]).toMatch(/"spawn" is a built-in name/);
    expect(errors(check("func is_spawned():\n    pass\n"))[0]).toMatch(/"is_spawned" is a built-in name/);
  });
});
