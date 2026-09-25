import { describe, expect, it } from "vitest";

import type { Animation } from "../animation";
import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/animation/TASK.animation-script-control.md */

function player(name: string, ...animationNames: string[]): SceneNode {
  const node = createSceneNode({ name, kind: "AnimationPlayer" });
  node.animation = { animations: animationNames.map((n): Animation => ({ id: `id-${n}`, name: n, length: 1, loop: false, tracks: [] })) };
  return node;
}
function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [player("Door", "open", "close"), player("Empty"), createSceneNode({ name: "Music", kind: "AudioStreamPlayer" }), createSceneNode({ name: "Cube", kind: "MeshInstance3D" })]
  });
}
type Attached = ScriptSceneContext["attached"];
const check = (source: string, attached: Attached = [{ name: "Cube", kind: "MeshInstance3D" }], root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const onPlayer = (...names: string[]): Attached => [{ name: "Door", kind: "AnimationPlayer" as SceneNodeKind, animations: names }];

describe("controlling an AnimationPlayer", () => {
  it("accepts play(name), stop(), is_playing() and speed_scale on a named player, and records the index of the animation", () => {
    const r = check(`func _process(delta):
    $Door.play("close")
    if $Door.is_playing():
        $Door.speed_scale = 2.0
        $Door.speed_scale += 0.5
    var s: float = $Door.speed_scale
    $Door.stop()
`);
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    const first = (body[0] as { kind: "expr"; expr: { res?: unknown } }).expr;
    expect(first.res).toMatchObject({ kind: "animCall", method: "play", animation: 1, target: { kind: "node", name: "Door" } });
    expect(r.usage.nodePlaysAnimation.size).toBe(1);
    expect(r.usage.selfPlaysAnimation).toBe(false);
  });

  it("accepts the bare forms in a script attached to the player, and notes it plays its own animation", () => {
    const r = check('func _ready():\n    play("open")\n    speed_scale = 0.5\n\nfunc _process(delta):\n    if is_playing():\n        stop()\n', onPlayer("open", "close"));
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfPlaysAnimation).toBe(true);
  });

  it("is an error to play an animation the player doesn't have, listing the ones it does", () => {
    expect(errors(check('func f():\n    $Door.play("shut")\n'))).toEqual(['$Door has no animation "shut". Its animations are: "open", "close".']);
    expect(errors(check('func f():\n    $Empty.play("x")\n'))).toEqual(["$Empty has no animations yet. Create one in the Animation panel."]);
    expect(errors(check('func f():\n    play("shut")\n', onPlayer("open")))).toEqual(['Door has no animation "shut". Its animations are: "open".']);
  });

  it("needs the name in quotes, exactly one", () => {
    expect(errors(check("func f():\n    $Door.play(3)\n"))[0]).toMatch(/play\(\) needs the animation's name in quotes, like play\("open"\)/);
    expect(errors(check("func f():\n    var n = 1\n    $Door.play(n)\n"))[0]).toMatch(/needs the animation's name in quotes/);
    expect(errors(check("func f():\n    $Door.play()\n"))[0]).toMatch(/play\("name"\) takes 1 argument, but 0 were given/);
    expect(errors(check('func f():\n    $Door.play("open", "close")\n'))[0]).toMatch(/takes 1 argument, but 2 were given/);
    expect(errors(check("func f():\n    $Door.stop(1)\n"))[0]).toMatch(/stop\(\) takes 0 arguments, but 1 was given/);
  });

  it("keeps a sound player's play() and stop() as they were, and says what each kind takes", () => {
    expect(errors(check("func f():\n    $Music.play()\n    $Music.stop()\n"))).toEqual([]);
    expect(errors(check('func f():\n    $Music.play("x")\n'))[0]).toMatch(/play\(\) takes 0 arguments, but 1 was given/);
    expect(errors(check("func f():\n    $Music.is_playing()\n"))[0]).toMatch(/\$Music is a AudioStreamPlayer, which has no "is_playing"/);
    expect(errors(check("func f():\n    $Music.speed_scale = 1.0\n"))[0]).toMatch(/\$Music is a AudioStreamPlayer, which has no "speed_scale"/);
    expect(errors(check("func f():\n    $Door.play()\n"))[0]).toMatch(/takes 1 argument/);
  });

  it("is an error on a node that is neither, naming what it is", () => {
    expect(errors(check('func f():\n    $Cube.play("x")\n'))[0]).toMatch(/\$Cube is a MeshInstance3D, which has no "play"/);
    expect(errors(check("func f():\n    var x = $Cube.is_playing()\n"))[0]).toMatch(/\$Cube is a MeshInstance3D, which has no "is_playing"/);
  });

  it("types speed_scale as a float, and is_playing as a bool", () => {
    expect(errors(check("func f():\n    $Door.speed_scale = true\n")).length).toBe(1);
    expect(errors(check("func f():\n    var n: int = $Door.is_playing()\n")).length).toBe(1);
    expect(errors(check("func f() -> bool:\n    return $Door.is_playing()\n"))).toEqual([]);
  });

  it("has these as built-in names, must be called, and has no cascade when the player is unknown", () => {
    expect(errors(check("var speed_scale = 1\n"))[0]).toMatch(/"speed_scale" is a built-in name/);
    expect(errors(check("var is_playing = 1\n"))[0]).toMatch(/"is_playing" is a built-in name/);
    expect(errors(check("func f():\n    var x = $Door.is_playing\n"))[0]).toMatch(/is_playing must be called: is_playing\(\)/);
    expect(errors(check('func f():\n    $Nobody.play("x")\n'))).toEqual(['There is no node named "Nobody" in the scene.']);
  });

  it("with the same animation in a different place in each player a script is attached to, says it can't tell which", () => {
    const attached: Attached = [
      { name: "A", kind: "AnimationPlayer", animations: ["open", "close"] },
      { name: "B", kind: "AnimationPlayer", animations: ["close", "open"] }
    ];
    expect(errors(check('func f():\n    play("open")\n', attached))[0]).toMatch(/not in the same place in every animation player this script is attached to/);
    expect(errors(check('func f():\n    play("open")\n', [{ name: "A", kind: "AnimationPlayer", animations: ["open"] }, { name: "B", kind: "AnimationPlayer", animations: ["open", "x"] }]))).toEqual([]);
  });

  it("is taken by its arguments before the script is attached: play(name) is an animation, play() a sound", () => {
    expect(errors(check('func f():\n    play("open")\n', []))).toEqual([]);
    expect(errors(check("func f():\n    play()\n", []))).toEqual([]);
  });
});
