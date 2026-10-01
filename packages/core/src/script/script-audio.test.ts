import { describe, expect, it } from "vitest";

import type { AudioClip } from "../audio-player";
import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/audio/STORY.named-audio-clips.md: play("name") starts one of an AudioStreamPlayer's own named clips. */

function clip(name: string): AudioClip {
  return { id: `id-${name}`, name, soundId: `sound-${name}`, volume: 1, pitch: 1, loop: false };
}
function player(name: string, ...clipNames: string[]): SceneNode {
  const node = createSceneNode({ name, kind: "AudioStreamPlayer" });
  node.audio = { autoplay: false, volume: 1, pitch: 1, loop: false, clips: clipNames.map(clip) };
  return node;
}
function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [player("Music", "Morning", "Day", "Night"), player("Empty"), createSceneNode({ name: "Cube", kind: "MeshInstance3D" })]
  });
}
type Attached = ScriptSceneContext["attached"];
const check = (source: string, attached: Attached = [{ name: "Cube", kind: "MeshInstance3D" }], root = scene()): ScriptCheckResult => checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const onPlayer = (...names: string[]): Attached => [{ name: "Music", kind: "AudioStreamPlayer" as SceneNodeKind, sounds: names }];

describe("playing a named clip on an AudioStreamPlayer", () => {
  it("accepts play(name) on a named player, and records the clip's index", () => {
    const r = check('func _process(delta):\n    $Music.play("Day")\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    const first = (body[0] as { kind: "expr"; expr: { res?: unknown } }).expr;
    expect(first.res).toMatchObject({ kind: "audioCall", method: "play", clip: 1, target: { kind: "node", name: "Music" } });
  });

  it("accepts the bare forms in a script attached to the player, and still resolves play(name) to a clip", () => {
    const r = check('func _ready():\n    play("Morning")\n    volume = 0.5\n\nfunc _process(delta):\n    stop()\n', onPlayer("Morning", "Day", "Night"));
    expect(errors(r)).toEqual([]);
  });

  it("play() and stop() with no name are unaffected: they still mean the player's own sound", () => {
    const r = check('func f():\n    $Music.play()\n    $Music.stop()\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    const first = (body[0] as { kind: "expr"; expr: { res?: { clip?: number } } }).expr;
    expect(first.res).toMatchObject({ kind: "audioCall", method: "play" });
    expect(first.res?.clip).toBeUndefined();
  });

  it("is an error to play a clip the player doesn't have, listing the ones it does", () => {
    expect(errors(check('func f():\n    $Music.play("Noon")\n'))).toEqual(['$Music has no sound "Noon". Its named sounds are: "Morning", "Day", "Night".']);
    expect(errors(check('func f():\n    $Empty.play("x")\n'))).toEqual(["$Empty has no named sounds yet. Add one in the Inspector."]);
    expect(errors(check('func f():\n    play("Noon")\n', onPlayer("Morning")))).toEqual(['Music has no sound "Noon". Its named sounds are: "Morning".']);
  });

  it("needs the name in quotes", () => {
    expect(errors(check('func f():\n    $Music.play(3)\n'))[0]).toMatch(/play\(\) needs the sound's name in quotes, like play\("Morning"\)/);
    expect(errors(check("func f():\n    var n = 1\n    $Music.play(n)\n"))[0]).toMatch(/needs the sound's name in quotes/);
  });

  it("with the same clip in a different place in each player a script is attached to, says it can't tell which", () => {
    const attached: Attached = [
      { name: "A", kind: "AudioStreamPlayer", sounds: ["Morning", "Night"] },
      { name: "B", kind: "AudioStreamPlayer", sounds: ["Night", "Morning"] }
    ];
    expect(errors(check('func f():\n    play("Morning")\n', attached))[0]).toMatch(/not in the same place in every audio player this script is attached to/);
  });
});
