import { createSceneNode, type Animation, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { scriptedProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/animation/TASK.compile-and-run-animations.md (the part that needs no toolchain) */

const mesh = (name: string): SceneNode => createSceneNode({ name, kind: "MeshInstance3D", mesh: "cube" });
function player(name: string, animations: Animation[], autoplay?: string, speed?: number): SceneNode {
  const node = createSceneNode({ name, kind: "AnimationPlayer" });
  node.animation = { animations, ...(autoplay ? { autoplay } : {}), ...(speed ? { speed } : {}) };
  return node;
}
const slide = (target: SceneNode, id = "slide"): Animation => ({
  id,
  name: id,
  length: 2,
  loop: false,
  tracks: [
    { id: `${id}-p`, nodeId: target.id, property: "position", keys: [{ time: 0, value: { x: -2, y: 0, z: 0 } }, { time: 2, value: { x: 2, y: 1, z: 0 } }] },
    { id: `${id}-v`, nodeId: target.id, property: "visible", keys: [{ time: 0, value: true }, { time: 1, value: false }] }
  ]
});
const translate = (extra: SceneNode[], scripts: Array<{ source: string; attachTo?: string[] }> = []) => translateScene3D(scriptedProject(scripts, extra));
const codes = (r: ReturnType<typeof translate>) => r.diagnostics.map((d) => `${d.code}${d.nodeName ? `:${d.nodeName}` : ""}`);

describe("animations in the scene description", () => {
  it("writes the tables in 20.12, and points the player's node at its animation", () => {
    const cube = mesh("Box");
    const r = translate([cube, player("Anim", [slide(cube)], "slide", 2)]);
    const scene = r.scene!;
    const box = scene.nodes.findIndex((n) => n.name === "Box");
    expect(scene.animationKeys).toEqual([
      { time: 0, value: [-8192, 0, 0] },
      { time: 8192, value: [8192, 4096, 0] },
      { time: 0, value: [1, 0, 0] }, // a bool is 1 or 0, not a 20.12 number
      { time: 4096, value: [0, 0, 0] }
    ]);
    expect(scene.animationTracks).toEqual([
      { property: "position", node: box, keyStart: 0, keyCount: 2 },
      { property: "visible", node: box, keyStart: 2, keyCount: 2 }
    ]);
    expect(scene.animations).toEqual([{ name: "slide", length: 8192, loop: false, trackStart: 0, trackCount: 2 }]);
    expect(scene.animationPlayers).toEqual([{ animationStart: 0, animationCount: 1, autoplay: 0, speed: 8192 }]);
    expect(scene.nodes.find((n) => n.name === "Anim")!.animPlayer).toBe(0);
    expect(scene.nodes.find((n) => n.name === "Box")!.animPlayer).toBe(-1);
    expect(r.diagnostics).toEqual([]);
  });

  it("numbers several players' animations, tracks and keys in runs, and autoplay is an index within the player", () => {
    const a = mesh("A");
    const b = mesh("B");
    const r = translate([a, b, player("P1", [slide(a, "s1"), slide(a, "s2")], "s2"), player("P2", [slide(b, "s3")], "s3")]);
    const scene = r.scene!;
    expect(scene.animationPlayers).toEqual([
      { animationStart: 0, animationCount: 2, autoplay: 1, speed: 4096 },
      { animationStart: 2, animationCount: 1, autoplay: 0, speed: 4096 }
    ]);
    expect(scene.animations.map((x) => [x.name, x.trackStart, x.trackCount])).toEqual([["s1", 0, 2], ["s2", 2, 2], ["s3", 4, 2]]);
    expect(scene.animationTracks.map((t) => [t.keyStart, t.keyCount])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2]]);
  });

  it("writes the tables into the generated C, with placeholders when there are none", () => {
    const cube = mesh("Box");
    const text = writeSceneDataC(translate([cube, player("Anim", [slide(cube)], "slide")]).scene!);
    expect(text).toContain("static const GsAnimKey animKeys[] = {\n  { 0, { -8192, 0, 0 } },\n  { 8192, { 8192, 4096, 0 } },\n  { 0, { 1, 0, 0 } },\n  { 4096, { 0, 0, 0 } }\n};");
    expect(text).toContain("static const GsAnimTrack animTracks[] = {\n  { 0, ");
    expect(text).toContain("static const GsAnimationPlayer animationPlayers[] = {\n  { 0, 1, 0, 4096 }\n};");
    expect(text).toContain("  1, 1, 2, 4, /* animation player, animation, track, key counts */");
    const none = writeSceneDataC(translateScene3D(scriptedProject([])).scene!);
    expect(none).toContain("static const GsAnimationPlayer animationPlayers[] = {\n  { 0, 0, -1, 0 }\n};");
  });

  it("makes a node with a position, rotation or scale track movable, and keeps a hidden node a track animates", () => {
    const mover = mesh("Mover");
    const shy = mesh("Shy");
    shy.visible = false;
    const still = mesh("Still");
    const rotate: Animation = { id: "r", name: "r", length: 1, loop: true, tracks: [{ id: "t", nodeId: mover.id, property: "rotation", keys: [{ time: 0, value: { x: 0, y: 0, z: 0 } }] }] };
    const show: Animation = { id: "s", name: "s", length: 1, loop: false, tracks: [{ id: "t2", nodeId: shy.id, property: "visible", keys: [{ time: 0, value: true }] }] };
    const scene = translate([mover, shy, still, player("Anim", [rotate, show], "r")]).scene!;
    const node = (name: string) => scene.nodes.find((n) => n.name === name);
    expect(node("Mover")!.dynamic).toBe(true);
    expect(node("Still")!.dynamic).toBe(false);
    expect(node("Shy")).toBeDefined(); // kept although hidden: an animation can show it
    expect(node("Shy")!.visible).toBe(false);
    expect(node("Shy")!.dynamic).toBe(false); // a visibility track doesn't move it
  });

  it("does not keep what a hidden player animates", () => {
    const shy = mesh("Shy");
    shy.visible = false;
    const hiddenPlayer = player("Anim", [slide(shy)], "slide");
    hiddenPlayer.visible = false;
    const scene = translate([shy, hiddenPlayer]).scene!;
    expect(scene.nodes.some((n) => n.name === "Shy")).toBe(false);
    expect(scene.animationPlayers).toEqual([]);
  });
});

describe("diagnostics for animations", () => {
  it("warns about a player whose animations nothing starts", () => {
    const cube = mesh("Box");
    const r = translate([cube, player("Anim", [slide(cube)])]);
    expect(codes(r)).toEqual(["animation-not-started:Anim"]);
    expect(r.scene).not.toBeNull();
    expect(r.diagnostics[0].message).toMatch(/None of this player's animations is its Autoplay and no script calls play\(\) on it/);
  });

  it("is quiet when a player has an autoplay", () => {
    const cube = mesh("Box");
    expect(codes(translate([cube, player("Anim", [slide(cube)], "slide")]))).toEqual([]);
  });

  it("leaves out a player with no animations, with a warning", () => {
    const r = translate([player("Empty", [])]);
    expect(codes(r)).toEqual(["player-without-animations:Empty"]);
    expect(r.scene!.animationPlayers).toEqual([]);
    expect(r.scene!.nodes.find((n) => n.name === "Empty")!.animPlayer).toBe(-1);
  });

  it("stops the build for a value that doesn't fit the DS's numbers, naming the player", () => {
    const cube = mesh("Box");
    const wild: Animation = { id: "w", name: "w", length: 1, loop: false, tracks: [{ id: "t", nodeId: cube.id, property: "position", keys: [{ time: 0, value: { x: 900000, y: 0, z: 0 } }] }] };
    const r = translate([cube, player("Anim", [wild], "w")]);
    expect(r.scene).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "out-of-range")!.nodeName).toBe("Anim");
  });

  it("stops the build when a track's node isn't in the game", () => {
    const cube = mesh("Box");
    const gone = mesh("Gone");
    const r = translate([cube, player("Anim", [slide(gone)], "slide")]);
    expect(r.scene).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "animation-target-missing")!.nodeName).toBe("Anim");
  });
});

describe("scripts that control an animation player", () => {
  const withScript = (source: string, extra: SceneNode[]) => translate([mesh("Ctl"), ...extra], [{ source, attachTo: ["Ctl"] }]);

  it("compiles play, stop, is_playing and speed_scale to calls with the player's node and the animation's place", () => {
    const cube = mesh("Box");
    const r = withScript(
      'func _process(delta):\n    $Anim.play("second")\n    $Anim.stop()\n    if $Anim.is_playing():\n        $Anim.speed_scale = 2.0\n        $Anim.speed_scale += 0.5\n        var s = $Anim.speed_scale\n',
      [cube, player("Anim", [slide(cube, "first"), slide(cube, "second")])]
    );
    expect(r.scene).not.toBeNull();
    const code = r.scene!.scriptCode;
    const anim = r.scene!.nodes.findIndex((n) => n.name === "Anim");
    expect(code).toContain(`gs_anim_play(gs_node_anim_player(${anim}), 1)`);
    expect(code).toContain(`gs_anim_stop(gs_node_anim_player(${anim}))`);
    expect(code).toContain(`gs_anim_is_playing(gs_node_anim_player(${anim}))`);
    expect(code).toContain(`gs_anim_set_speed(gs_node_anim_player(${anim}), 8192)`);
    expect(code).toContain(`gs_anim_get_speed(gs_node_anim_player(${anim}))`);
  });

  it("doesn't warn that nothing starts an animation when a script plays it, and makes what it animates movable", () => {
    const cube = mesh("Box");
    const r = withScript('func _process(delta):\n    $Anim.play("slide")\n', [cube, player("Anim", [slide(cube)])]);
    expect(codes(r)).toEqual([]);
    expect(r.scene!.nodes.find((n) => n.name === "Box")!.dynamic).toBe(true);
  });

  it("compiles the bare forms in a script attached to the player itself, which also counts as starting it", () => {
    const cube = mesh("Box");
    const anim = player("Anim", [slide(cube)]);
    const r = translate([cube, anim], [{ source: 'func _ready():\n    play("slide")\n    speed_scale = 0.5\n', attachTo: ["Anim"] }]);
    expect(codes(r)).toEqual([]);
    expect(r.scene!.scriptCode).toMatch(/gs_anim_play\(gs_node_anim_player\(gss0_self\[inst\]\), 0\)/);
  });

  it("stops the build for an animation the player doesn't have, naming the script, line and column", () => {
    const cube = mesh("Box");
    const r = withScript('func _process(delta):\n    $Anim.play("nope")\n', [cube, player("Anim", [slide(cube)])]);
    expect(r.scene).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "script-error")!.message).toMatch(/^line 2, column 16: \$Anim has no animation "nope"\. Its animations are: "slide"\./);
  });
});

