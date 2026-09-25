import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { completeScript, type ScriptCompletion } from "./completion";
import type { ScriptSceneContext } from "./checker";

/** A scene with a mesh that is a body (a shape under it), a bare mesh, a sound player, an animation player, a shape on its own and a node named with a space. */
function scene(): SceneNode {
  const door = createSceneNode({ name: "Door", kind: "AnimationPlayer" });
  door.animation = {
    speed: 1,
    autoplay: null,
    animations: [
      { id: "a1", name: "open", length: 1, loop: false, tracks: [] },
      { id: "a2", name: "close", length: 1, loop: false, tracks: [] }
    ]
  } as unknown as SceneNode["animation"];
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Player", kind: "MeshInstance3D", children: [createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" })] }),
      createSceneNode({ name: "Cube", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" }),
      door,
      createSceneNode({ name: "Score Text", kind: "MeshInstance3D" })
    ]
  });
}

const attachedTo = (kind: SceneNodeKind, extra: { hasShape?: boolean; animations?: string[] } = {}): ScriptSceneContext["attached"] => [{ name: "This", kind, ...extra }];

/** `|` marks the cursor. Returns the labels offered whose text starts with what was typed (the editor does this narrowing), and the raw result. */
function at(marked: string, attached: ScriptSceneContext["attached"] = attachedTo("MeshInstance3D"), explicit = false) {
  const cursor = marked.indexOf("|");
  const source = marked.slice(0, cursor) + marked.slice(cursor + 1);
  const result = completeScript(source, cursor, { root: scene(), attached }, explicit);
  const typed = result ? source.slice(result.from, cursor) : "";
  const labels = result ? result.options.filter((o) => o.label.toLowerCase().startsWith(typed.toLowerCase())).map((o) => o.label) : null;
  return { result, labels, typed, source, cursor };
}
const find = (options: ScriptCompletion[] | undefined, label: string): ScriptCompletion => {
  const found = options?.find((o) => o.label === label);
  if (!found) throw new Error(`no "${label}" in ${JSON.stringify(options?.map((o) => o.label))}`);
  return found;
};

describe("script completion: words", () => {
  it("offers a statement only at the start of a line", () => {
    expect(at("func _process(delta):\n    wh|").labels).toEqual(["while"]);
    expect(at("func _process(delta):\n    var x = wh|").labels).toEqual([]);
  });

  it("offers the built-in functions, inserted with their brackets and the cursor inside", () => {
    const { result, labels } = at("func _process(delta):\n    var x = cl|");
    expect(labels).toEqual(["clamp"]);
    expect(find(result?.options, "clamp")).toMatchObject({ insert: "clamp(, , )", caretBack: 5 });
    expect(find(result?.options, "abs")).toMatchObject({ insert: "abs()", caretBack: 1 });
  });

  it("does not offer position for 'mo', and offers move_and_collide only where the node can move as a body", () => {
    expect(at("func _process(delta):\n    mo|", attachedTo("MeshInstance3D", { hasShape: true })).labels).toEqual(["move_and_collide"]);
    expect(at("func _process(delta):\n    mo|", attachedTo("MeshInstance3D")).labels).toEqual([]);
  });

  it("offers a whole _process function to type at the start of a line", () => {
    const { result, labels } = at("fu|", attachedTo("MeshInstance3D"));
    expect(labels).toEqual(["func _process(delta):", "func _ready():", "func"]);
    expect(find(result?.options, "func _process(delta):").insert).toBe("func _process(delta):\n    ");
  });

  it("starts after the word being typed and replaces what was typed", () => {
    const { result, source } = at("func _process(delta):\n    var speed = 2.0 * sq|");
    expect(source.slice(result!.from)).toBe("sq");
  });

  it("offers nothing without a letter typed, unless it was asked for", () => {
    expect(at("func _process(delta):\n    |").result).toBeNull();
    expect(at("func _process(delta):\n    |", attachedTo("MeshInstance3D"), true).result).not.toBeNull();
  });

  it("offers types after a colon in a declaration", () => {
    expect(at("var speed: fl|").labels).toEqual(["float"]);
    expect(at("func jump(power: |", attachedTo("MeshInstance3D"), true).labels).toEqual(["int", "float", "bool"]);
  });

  it("offers nothing where a new name is being written", () => {
    expect(at("func ju|").result).toBeNull();
    expect(at("var sp|").result).toBeNull();
    expect(at("func _process(delta):\n    for i|").result).toBeNull();
  });

  it("offers nothing in a comment or in the tail of a number", () => {
    expect(at("func _process(delta):\n    # move the pl|").result).toBeNull();
    expect(at("func _process(delta):\n    var x = 2.5f|").result).toBeNull();
  });
});

describe("script completion: the script's own names", () => {
  const source = `var speed = 2.0
var lives: int = 3
var alive = true

func jump(power: float):
    var height = power * 2.0
    for step in range(3):
        pass
    he|

func _process(delta):
    var other = 1
    x|
`;
  it("offers the variables with their types, and the functions", () => {
    const first = at(source.replace("he|", "sp|"));
    expect(find(first.result?.options, "speed")).toMatchObject({ kind: "variable", detail: "float" });
    expect(find(first.result?.options, "lives")).toMatchObject({ detail: "int" });
    expect(find(first.result?.options, "alive")).toMatchObject({ detail: "bool" });
    expect(find(first.result?.options, "jump")).toMatchObject({ kind: "function", detail: "(power: float)", insert: "jump()", caretBack: 1 });
  });

  it("offers the locals of the function being edited, and parameters and loop variables, and not another function's", () => {
    const inJump = at(source).result!.options.map((o) => o.label);
    expect(inJump).toEqual(expect.arrayContaining(["height", "power", "step"]));
    expect(inJump).not.toContain("other");
    const inProcess = at(source.replace("he|", "").replace("x|", "x|")).result!.options.map((o) => o.label);
    expect(inProcess).toEqual(expect.arrayContaining(["other", "delta"]));
    expect(inProcess).not.toContain("height");
    expect(inProcess).not.toContain("power");
  });

  it("leaves the special functions out (they are not called)", () => {
    const all = at("func _ready():\n    pass\nfunc _process(delta):\n    x|").result!.options.map((o) => o.label);
    expect(all).not.toContain("_ready");
    expect(all).not.toContain("_process");
  });
});

describe("script completion: members of the node the script is on (written without self.)", () => {
  const labelsFor = (attached: ScriptSceneContext["attached"]) => at("func _process(delta):\n    x|", attached).result!.options.map((o) => o.label);
  it("gives a mesh its transform and nothing of audio", () => {
    const labels = labelsFor(attachedTo("MeshInstance3D"));
    expect(labels).toEqual(expect.arrayContaining(["position", "rotation", "scale", "visible"]));
    expect(labels).not.toContain("volume");
    expect(labels).not.toContain("is_on_floor");
  });
  it("gives a mesh with a shape under it the body calls", () => {
    expect(labelsFor(attachedTo("MeshInstance3D", { hasShape: true }))).toEqual(expect.arrayContaining(["move_and_collide", "is_on_floor", "is_on_wall", "is_on_ceiling"]));
  });
  it("gives a sound player its own members and no position", () => {
    const labels = labelsFor(attachedTo("AudioStreamPlayer"));
    expect(labels).toEqual(expect.arrayContaining(["volume", "pitch", "play", "stop"]));
    expect(labels).not.toContain("position");
  });
  it("gives everything to a script that is attached to nothing yet", () => {
    expect(labelsFor([])).toEqual(expect.arrayContaining(["position", "volume", "is_playing", "overlaps", "move_and_collide"]));
  });
});

describe("script completion: nodes after $", () => {
  it("offers every node with its kind", () => {
    const { result } = at("func _process(delta):\n    $|");
    expect(result!.options.map((o) => o.label)).toEqual(["$Cube", "$Door", "$Main", "$Music", "$Player", "$PlayerShape", '$"Score Text"']);
    expect(find(result?.options, "$Music").detail).toBe("AudioStreamPlayer");
  });
  it("replaces the dollar and what follows it", () => {
    const { result, source } = at("func _process(delta):\n    $Cu|");
    expect(source.slice(result!.from)).toBe("$Cu");
    expect(at("func _process(delta):\n    $Cu|").labels).toEqual(["$Cube"]);
  });
  it("offers names inside $\" quotes too, closing the quote", () => {
    const { result, source } = at('func _process(delta):\n    $"Sc|');
    expect(source.slice(result!.from)).toBe("Sc");
    expect(find(result?.options, "Score Text")).toMatchObject({ insert: 'Score Text"' });
  });
});

describe("script completion: after a dot", () => {
  const labelsOf = (marked: string, attached?: ScriptSceneContext["attached"]) => at(marked, attached).result?.options.map((o) => o.label) ?? null;

  it("offers Input's functions, the button ones reopening the list inside their quotes", () => {
    const { result } = at("func _process(delta):\n    if Input.|");
    expect(result!.options.map((o) => o.label)).toEqual(["is_button_down", "is_button_pressed", "is_button_released", "is_touching", "touch_x", "touch_y"]);
    expect(find(result?.options, "is_button_down")).toMatchObject({ insert: 'is_button_down("")', caretBack: 2, reopen: true });
  });

  it("follows the kind of node: a sound player, a mesh, a shape, a body, an animation player", () => {
    expect(labelsOf("func _process(delta):\n    $Music.|")).toEqual(["volume", "pitch", "play", "stop"]);
    expect(labelsOf("func _process(delta):\n    $Cube.|")).toEqual(["position", "rotation", "scale", "visible"]);
    expect(labelsOf("func _process(delta):\n    $PlayerShape.|")).toEqual(["position", "rotation", "scale", "visible", "overlaps", "move_and_collide", "is_on_floor", "is_on_wall", "is_on_ceiling"]);
    expect(labelsOf("func _process(delta):\n    $Player.|")).toEqual(["position", "rotation", "scale", "visible", "move_and_collide", "is_on_floor", "is_on_wall", "is_on_ceiling"]);
    expect(labelsOf("func _process(delta):\n    $Door.|")).toEqual(["play", "stop", "is_playing", "speed_scale"]);
  });

  it('works with a quoted name, and offers nothing for a name that is not in the scene', () => {
    expect(labelsOf('func _process(delta):\n    $"Score Text".|')).toEqual(["position", "rotation", "scale", "visible"]);
    expect(labelsOf("func _process(delta):\n    $Nobody.|")).toBeNull();
  });

  it("uses the node the script is on for self.", () => {
    expect(labelsOf("func _process(delta):\n    self.|", attachedTo("AudioStreamPlayer"))).toEqual(["volume", "pitch", "play", "stop"]);
  });

  it("starts at the letters typed after the dot", () => {
    const { result, source, labels } = at("func _process(delta):\n    $Music.vo|");
    expect(source.slice(result!.from)).toBe("vo");
    expect(labels).toEqual(["volume"]);
  });

  it("offers x, y and z after a vector", () => {
    expect(labelsOf("func _process(delta):\n    position.|")).toEqual(["x", "y", "z"]);
    expect(labelsOf("func _process(delta):\n    $Cube.rotation.|")).toEqual(["x", "y", "z"]);
    expect(labelsOf("func _process(delta):\n    self.scale.|")).toEqual(["x", "y", "z"]);
  });

  it("offers nothing after a number's dot or a name that is not a node", () => {
    expect(at("func _process(delta):\n    var x = 2.|").result).toBeNull();
    expect(at("func _process(delta):\n    var x = speed.|").result).toBeNull();
    expect(at("func _process(delta):\n    $Cube.visible.|").result).toBeNull();
  });
});

describe("script completion: inside quotes", () => {
  it("offers the twelve buttons for Input.is_button_*", () => {
    for (const fnName of ["is_button_down", "is_button_pressed", "is_button_released"]) {
      const { result } = at(`func _process(delta):\n    if Input.${fnName}("|`);
      expect(result!.options.map((o) => o.label)).toEqual(["a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"]);
    }
  });

  it("closes the quote unless one is already there", () => {
    expect(find(at('func _process(delta):\n    if Input.is_button_down("|').result?.options, "a").insert).toBe('a"');
    expect(find(at('func _process(delta):\n    if Input.is_button_down("|")').result?.options, "a").insert).toBe("a");
  });

  it("offers the animation names of the player in play(", () => {
    expect(at('func _process(delta):\n    $Door.play("|').result!.options.map((o) => o.label)).toEqual(["open", "close"]);
    expect(at('func _process(delta):\n    play("|', attachedTo("AnimationPlayer", { animations: ["spin"] })).result!.options.map((o) => o.label)).toEqual(["spin"]);
  });

  it("offers nothing for a sound player's play, or a string that names nothing", () => {
    expect(at('func _process(delta):\n    $Music.play("|').result).toBeNull();
    expect(at('func _process(delta):\n    var x = "hel|').result).toBeNull();
  });
});
