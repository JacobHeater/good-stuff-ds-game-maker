import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSceneNode, encodeSamples, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { hasErrors } from "./diagnostics";
import { audioPlayerNode, scriptedProject, toneSound } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

type Project = ReturnType<typeof scriptedProject>;
const translate = (project: Project) => translateScene3D(project);
const scene = (project: Project) => {
  const result = translate(project);
  if (!result.scene) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
  return result.scene;
};
const codes = (project: Project): string[] => translate(project).diagnostics.map((d) => d.code);
const named = (name: string, kind: SceneNode["kind"] = "Node3D", children: SceneNode[] = []) => createSceneNode({ name, kind, children });
const mesh = (name: string) => createSceneNode({ name, kind: "MeshInstance3D" });
const hidden = (node: SceneNode): SceneNode => {
  node.visible = false;
  return node;
};

describe("a script with errors", () => {
  it("stops the build, naming the script, line and column", () => {
    const project = scriptedProject([{ name: "Player", source: "func _process(delta):\n    var x: int = 2.5\n" }]);
    const result = translate(project);
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "script-error", nodeName: "Player script", message: expect.stringMatching(/^line 2, column 18: A float can't go into an int/) })
    );
  });

  it("reports a syntax error and every error of a script that parses", () => {
    expect(translate(scriptedProject([{ source: "func _process(delta)\n    pass\n" }])).diagnostics.filter((d) => d.code === "script-error")).toHaveLength(1);
    const many = translate(scriptedProject([{ source: "func _process(delta):\n    nope()\n    var a: int = 1.5\n    $Missing.visible = true\n" }]));
    expect(many.diagnostics.filter((d) => d.code === "script-error")).toHaveLength(3);
  });

  it("reports warnings without stopping the build", () => {
    const result = translate(scriptedProject([{ source: "func _process(delta):\n    var unused = 1\n" }]));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "script-warning", message: expect.stringContaining('"unused" is never used') }));
    expect(result.scene).not.toBeNull();
  });

  it("checks a script against the kind of every node it is attached to", () => {
    const project = scriptedProject([{ source: "func _ready():\n    play()\n", attachTo: ["Cube", "Music"] }], [audioPlayerNode("Music")]);
    const result = translate(project);
    expect(result.scene).toBeNull();
    expect(result.diagnostics.find((d) => d.code === "script-error")!.message).toMatch(/"play" isn't available on Cube \(a MeshInstance3D\)/);
  });

  it("refuses a node whose script isn't in the project", () => {
    const project = scriptedProject([{ source: "func _ready():\n    pass\n" }]);
    project.scripts = [];
    const result = translate(project);
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-script", nodeName: "Cube" }));
  });

  it("ignores a script no node uses, even a broken one, so a half-written script never blocks a build", () => {
    const project = scriptedProject([{ name: "Draft", source: "this is not a script", attachTo: [] }]);
    expect(translate(project).diagnostics).toEqual([]);
    expect(scene(project).scriptCode).toContain("gs_script_instance_count = 0");
  });
});

describe("the node table", () => {
  it("lists every kept node, parents first, and points meshes, the camera and lights at theirs", () => {
    const s = scene(scriptedProject([]));
    expect(s.nodes.map((n) => [n.name, n.parent])).toEqual([["Main", -1], ["Cube", 0], ["Camera", 0], ["Sun", 0]]);
    expect([s.meshes[0].node, s.camera.node, s.lights[0].node]).toEqual([1, 2, 3]);
    expect(s.nodes.every((n) => !n.dynamic)).toBe(true);
    expect(s.nodes[1].rotation).toEqual([0, 30 * 4096, 0]);
    expect(s.nodes[1].scale).toEqual([4096, 4096, 4096]);
    expect(s.nodes[1].world).toEqual(s.meshes[0].world);
  });

  it("marks a node a script moves, and everything under it, as dynamic, and nothing else", () => {
    const group = named("Group", "Node3D", [mesh("Child"), named("Inner", "Node3D", [mesh("Grandchild")])]);
    const s = scene(scriptedProject([{ source: "func _process(delta):\n    $Group.rotation.y += 90 * delta\n", attachTo: ["Cube"] }], [group, mesh("Other")]));
    const dynamic = Object.fromEntries(s.nodes.map((n) => [n.name, n.dynamic]));
    expect(dynamic).toEqual({ Main: false, Cube: false, Camera: false, Sun: false, Group: true, Child: true, Inner: true, Grandchild: true, Other: false });
  });

  it("marks every node a script that writes its own transform is attached to as dynamic", () => {
    const s = scene(scriptedProject([{ source: "func _process(delta):\n    position.x += 1 * delta\n", attachTo: ["Cube", "Camera"] }]));
    expect(s.nodes.filter((n) => n.dynamic).map((n) => n.name)).toEqual(["Cube", "Camera"]);
  });

  it("doesn't make a node dynamic for being read, shown or hidden", () => {
    const source = "func _process(delta):\n    var x = position.x + $Sun.rotation.y\n    visible = false\n    $Camera.visible = true\n";
    expect(scene(scriptedProject([{ source }])).nodes.some((n) => n.dynamic)).toBe(false);
  });

  it("lets a script move the camera and a light", () => {
    const s = scene(scriptedProject([{ source: "func _process(delta):\n    $Camera.position.x += 1 * delta\n    $Sun.rotation.y += 10 * delta\n" }]));
    expect(s.nodes[s.camera.node].dynamic).toBe(true);
    expect(s.nodes[s.lights[0].node].dynamic).toBe(true);
  });

  it("drops a hidden node no script can reach, as before, and keeps one it can", () => {
    expect(scene(scriptedProject([], [hidden(mesh("Ghost"))])).nodes.map((n) => n.name)).not.toContain("Ghost");

    const source = 'func _process(delta):\n    if Input.is_button_pressed("a"):\n        $Ghost.visible = true\n';
    const shown = scene(scriptedProject([{ source }], [hidden(mesh("Ghost"))]));
    const kept = shown.nodes.find((n) => n.name === "Ghost")!;
    expect(kept.visible).toBe(false);
    expect(shown.meshes.some((m) => m.node === shown.nodes.indexOf(kept))).toBe(true);
  });

  it("keeps a hidden branch whose descendant a script reaches, and a hidden node a script is attached to", () => {
    const branch = hidden(named("Branch", "Node3D", [mesh("Target"), mesh("Sibling")]));
    const s = scene(scriptedProject([{ source: "func _process(delta):\n    $Target.position.x += 1 * delta\n" }], [branch]));
    expect(s.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(["Branch", "Target"]));
    // A visible node under the kept branch is kept with it (a script that shows the branch must show what is in it); it stays hidden through its parent.
    const sibling = s.nodes.find((n) => n.name === "Sibling")!;
    expect([sibling.visible, s.nodes[sibling.parent].visible]).toEqual([true, false]);
    expect(s.nodes.find((n) => n.name === "Branch")!.visible).toBe(false);
    // Whereas a hidden node under it that no script reaches is dropped.
    const dropped = scene(scriptedProject([{ source: "func _process(delta):\n    $Target.position.x += 1 * delta\n" }], [hidden(named("Branch", "Node3D", [mesh("Target"), hidden(mesh("Sibling"))]))]));
    expect(dropped.nodes.map((n) => n.name)).not.toContain("Sibling");

    const attached = scriptedProject([{ source: "func _process(delta):\n    pass\n", attachTo: ["Hidden"] }], [hidden(mesh("Hidden"))]);
    expect(scene(attached).nodes.map((n) => n.name)).toContain("Hidden");
  });

  it("errors on more than four lights kept", () => {
    const lights = [1, 2, 3, 4].map((i) => createSceneNode({ name: `L${i}`, kind: "DirectionalLight3D" }));
    expect(codes(scriptedProject([], lights))).toContain("too-many-lights"); // the Sun makes five
  });

  it("keeps every node's baked matrix, so a scene without moving nodes draws as before", () => {
    const withScript = scene(scriptedProject([{ source: "func _process(delta):\n    pass\n" }]));
    const without = scene(scriptedProject([]));
    expect(withScript.meshes[0].world).toEqual(without.meshes[0].world);
    expect(withScript.nodes.map((n) => n.world)).toEqual(without.nodes.map((n) => n.world));
  });
});

describe("scripts and sound", () => {
  const tone = toneSound("tone", { seconds: 0.05 });
  const withSound = (source: string, autoplay = false) => {
    const project = scriptedProject([{ source }], [audioPlayerNode("Music", { soundId: "tone", autoplay })]);
    project.sounds = [tone];
    return project;
  };

  it("doesn't warn about a player with Autoplay off when a script calls play() on it", () => {
    expect(codes(withSound("func _process(delta):\n    $Music.play()\n"))).not.toContain("sound-not-started");
    expect(codes(withSound("func _process(delta):\n    $Music.volume = 0.5\n"))).toContain("sound-not-started"); // touching it isn't starting it
  });

  it("gives a node its audio player index, and -1 to the others", () => {
    const s = scene(withSound("func _process(delta):\n    $Music.play()\n"));
    expect(s.nodes.map((n) => n.audio)).toEqual([-1, -1, -1, -1, 0]);
    expect(s.audioPlayers[0].autoplay).toBe(false);
  });

  it("doesn't start a hidden player at once, even with Autoplay on", () => {
    const project = scriptedProject([{ source: "func _process(delta):\n    $Music.play()\n" }], [hidden(audioPlayerNode("Music", { soundId: "tone", autoplay: true }))]);
    project.sounds = [tone];
    expect(scene(project).audioPlayers[0].autoplay).toBe(false);
  });

  it("uses a player's own node when a script on the player itself calls play()", () => {
    const project = scriptedProject([{ source: "func _ready():\n    play()\n", attachTo: ["Music"] }], [audioPlayerNode("Music", { soundId: "tone", autoplay: false })]);
    project.sounds = [{ ...tone, samples: encodeSamples(new Int16Array(8)) }];
    const s = scene(project);
    expect(s.scriptCode).toContain("gs_audio_play(gs_node_audio_player(gss0_self[inst]))");
    expect(codes(project)).not.toContain("sound-not-started");
  });
});

describe("the generated C", () => {
  const SOURCE = `var speed = 2.5
var count: int = 3
var alive = true

func helper(a: int, b: float) -> float:
    return float(a) * b + speed / 2

func _ready():
    position.x = -1.5

func _process(delta):
    var i = 7 / 2
    var f = 7 / 2.0
    count += 1
    speed *= 2
    if Input.is_button_down("left") and not alive:
        position.x -= speed * delta
    elif Input.is_button_pressed("a"):
        visible = false
    for k in range(count):
        rotation.y += clamp(f, 0, 90) + sin(45) + float(abs(-k))
    while i > 0:
        i -= 1
        if i == 3:
            break
    var t = Input.touch_x() + int(f) % 3
    helper(t, 1)
`;
  const code = scene(scriptedProject([{ name: "Probe", source: SOURCE }])).scriptCode;

  it("keeps each variable per node, with its initial value in the DS's format", () => {
    expect(code).toContain("\tint32_t m_speed; /* float */\n\tint32_t m_count; /* int */\n\tint32_t m_alive; /* bool */");
    expect(code).toContain("static gss0_State gss0_state[1] = {\n\t{ 10240, 3, 1 }\n};"); // 2.5 is 10240 in 20.12
    expect(code).toContain("static const uint16_t gss0_self[1] = { 1 };");
  });

  it("does fixed-point arithmetic: float * float and float / float go through the helpers, int and float mix without them", () => {
    expect(code).toContain("return (gs_mulf(gs_i2f(p_a), p_b) + gs_divi(gss0_state[inst].m_speed, 2));");
    expect(code).toContain("int32_t v_i = gs_divi(7, 2);");
    expect(code).toContain("int32_t v_f = gs_divf(28672, 8192);"); // 7 and 2.0 already in 20.12
    expect(code).toContain("gss0_state[inst].m_count = (gss0_state[inst].m_count + 1);");
    expect(code).toContain("gss0_state[inst].m_speed = (gss0_state[inst].m_speed * 2);"); // a float times an int needs no shift
    expect(code).toContain("gs_node_state[gss0_self[inst]].position[0] = (-6144);");
  });

  it("reads buttons and touch, converts numbers, and writes node members", () => {
    expect(code).toContain("if ((gs_key_down(GS_KEY_LEFT) && (!gss0_state[inst].m_alive))) {");
    expect(code).toContain("} else if (gs_key_pressed(GS_KEY_A)) {");
    expect(code).toContain("gs_node_state[gss0_self[inst]].visible = 0;");
    expect(code).toContain("gs_node_state[gss0_self[inst]].position[0] = (gs_node_state[gss0_self[inst]].position[0] - gs_mulf(gss0_state[inst].m_speed, p_delta));");
    expect(code).toContain("(gs_clamp(v_f, 0, 368640) + gs_sin(184320)) + gs_i2f(gs_abs((-v_k)))");
    expect(code).toContain("int32_t v_t = (gs_touch_x + gs_modi(gs_f2i(v_f), 3));");
    expect(code).toContain("gss0_helper(inst, v_t, 4096);"); // 1 as a float
  });

  it("evaluates a for loop's limit once, and maps lines back to the script", () => {
    expect(code).toMatch(/for \(int32_t v_k = 0, gs_end_\d+_\d+ = gss0_state\[inst\]\.m_count; v_k < gs_end_\d+_\d+; v_k\+\+\) \{/);
    expect(code).toContain('#line 11 "Probe"\nstatic void gss0__process(int inst, int32_t p_delta) {');
    expect(code).toContain('#line 21 "Probe"');
  });

  it("lists one entry per attached node with its ready and process functions", () => {
    expect(code).toContain("const GsScriptInstance gs_script_instances[] = {\n\t{ gss0__ready, (void (*)(int, int32_t))gss0__process, 1, 0 }\n};\nconst uint16_t gs_script_instance_count = 1;");
  });

  it("gives every attached node its own copy of the variables, ordered by node", () => {
    const s = scene(scriptedProject([{ source: "var n = 1\nfunc _process(delta):\n    n += 1\n", attachTo: ["Sun", "Cube", "Camera"] }]));
    expect(s.scriptCode).toContain("static gss0_State gss0_state[3] = {\n\t{ 1 },\n\t{ 1 },\n\t{ 1 }\n};");
    expect(s.scriptCode).toContain("static const uint16_t gss0_self[3] = { 1, 2, 3 };"); // node table order, not attachment order
    const entries = s.scriptCode.split("const GsScriptInstance gs_script_instances[] = {")[1];
    expect(entries.match(/gss0__process, (\d), (\d)/g)).toEqual(["gss0__process, 1, 0", "gss0__process, 2, 1", "gss0__process, 3, 2"]);
  });

  it("orders several scripts' entries by node, and names their functions apart", () => {
    const s = scene(
      scriptedProject([
        { name: "A", source: "func _ready():\n    pass\n", attachTo: ["Camera"] },
        { name: "B", source: "func _process(delta):\n    pass\n", attachTo: ["Cube"] }
      ])
    );
    expect(s.scriptCode).toMatch(/\{ 0, \(void \(\*\)\(int, int32_t\)\)gss1__process, 1, 0 \},\n\t\{ gss0__ready, 0, 2, 0 \}/);
  });

  it("is deterministic: the same scripts always give the same text", () => {
    expect(scene(scriptedProject([{ name: "Probe", source: SOURCE }])).scriptCode).toBe(code);
  });

  it("makes safe C names from script variables that are C keywords", () => {
    const s = scene(scriptedProject([{ source: "var long = 1\nvar char = 2\nfunc _process(delta):\n    long += char\n" }]));
    expect(s.scriptCode).toContain("int32_t m_long;");
    expect(s.scriptCode).not.toMatch(/int32_t long;/);
  });
});

describe("the example scripts kept in tests/prototypes/scripts", () => {
  const example = (file: string): string => readFileSync(resolve(__dirname, "../../../tests/prototypes/scripts", file), "utf-8");

  it("dpad-rotate compiles cleanly and writes the rotation, so the D-pad can turn the model", () => {
    const result = translate(scriptedProject([{ name: "DpadRotate", source: example("dpad-rotate.gsscript") }]));
    expect(result.diagnostics).toEqual([]);
    expect(result.scene!.nodes.find((n) => n.name === "Cube")!.dynamic).toBe(true);
  });

  it("move-8way compiles cleanly for a player with a shape under it and a solid floor, and moves and turns it", () => {
    const body = createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" });
    const player = createSceneNode({ name: "Player", kind: "MeshInstance3D", mesh: "cube", children: [body] });
    const floor = createSceneNode({ name: "Floor", kind: "CollisionShape3D" });
    floor.collision = { solid: true };
    const result = translate(scriptedProject([{ name: "Move8", source: example("move-8way.gsscript"), attachTo: ["Player"] }], [player, floor]));
    expect(result.diagnostics).toEqual([]);
    expect(result.scene!.nodes.find((n) => n.name === "Player")!.dynamic).toBe(true);
  });

  it("player-jump compiles cleanly for a player with a shape under it and a solid floor, and moves the player (its behaviour is checked on the DS in player-script.rom.test.ts)", () => {
    const body = createSceneNode({ name: "PlayerShape", kind: "CollisionShape3D" });
    const player = createSceneNode({ name: "Player", kind: "MeshInstance3D", mesh: "cube", children: [body] });
    const floor = createSceneNode({ name: "Floor", kind: "CollisionShape3D" });
    floor.collision = { solid: true };
    const result = translate(scriptedProject([{ name: "PlayerJump", source: example("player-jump.gsscript"), attachTo: ["Player"] }], [player, floor]));
    expect(result.diagnostics).toEqual([]);
    expect(result.scene!.nodes.find((n) => n.name === "Player")!.dynamic).toBe(true);
  });

  it("player-jump is an error on a node with no collision shape under it, and says so", () => {
    const result = translate(scriptedProject([{ name: "PlayerJump", source: example("player-jump.gsscript") }]));
    expect(result.scene).toBeNull();
    expect(result.diagnostics.map((d) => d.message).join("\n")).toMatch(/needs a node with a collision shape under it, and this script is attached to Cube, which has none/);
  });
});
