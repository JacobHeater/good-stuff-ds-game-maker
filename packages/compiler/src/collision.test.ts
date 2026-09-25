import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { scriptedProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/collision/TASK.compile-and-run-collision-checks.md (the part that needs no toolchain) */

const ORIGIN = { x: 0, y: 0, z: 0 };
function shape(name: string, collision?: SceneNode["collision"], position = ORIGIN): SceneNode {
  const node = createSceneNode({
    name,
    kind: "CollisionShape3D",
    transform3D: { position, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } }
  });
  if (collision) node.collision = collision;
  return node;
}
const translate = (source: string, extra: SceneNode[], attachTo?: string[]) => translateScene3D(scriptedProject([{ source, attachTo }], extra));
const CHECK = "func _process(delta):\n    if $A.overlaps($B):\n        $Cube.visible = false\n";

describe("collision shapes in the scene description", () => {
  it("compiles each shape with its size in 20.12, and points the node at it", () => {
    const r = translate(CHECK, [
      shape("A", { shape: "box", size: { x: 2, y: 4, z: 6 } }),
      shape("B", { shape: "sphere", radius: 1.5 }),
      shape("C", { shape: "capsule", radius: 0.5, height: 3 }),
      shape("D", { shape: "cylinder", radius: 0.25, height: 2 }),
      shape("E")
    ]);
    const scene = r.scene!;
    expect(scene.colliders).toEqual([
      { shape: "box", solid: false, params: [4096, 8192, 12288] }, // half extents
      { shape: "sphere", solid: false, params: [6144, 0, 0] },
      { shape: "capsule", solid: false, params: [2048, 4096, 0] }, // radius 0.5, straight part (3 - 2 * 0.5) / 2 = 1
      { shape: "cylinder", solid: false, params: [1024, 4096, 0] }, // radius 0.25, half of 2
      { shape: "box", solid: false, params: [2048, 2048, 2048] } // the default: a 1 x 1 x 1 box
    ]);
    const colliderOf = (name: string) => scene.nodes.find((n) => n.name === name)!.collider;
    expect(["A", "B", "C", "D", "E"].map(colliderOf)).toEqual([0, 1, 2, 3, 4]);
    expect(scene.nodes.filter((n) => n.collider >= 0)).toHaveLength(5);
    expect(colliderOf("Cube")).toBe(-1);
  });

  it("gives a capsule no straight part when it is as tall as it is wide, and reads a squashed one as that", () => {
    const r = translate(CHECK, [shape("A", { shape: "capsule", radius: 1, height: 2 }), shape("B", { shape: "capsule", radius: 1, height: 0.5 })]);
    expect(r.scene!.colliders.map((c) => c.params)).toEqual([[4096, 0, 0], [4096, 0, 0]]);
  });

  it("writes the table, the count and the node's index into the generated C", () => {
    const scene = translate(CHECK, [shape("A", { shape: "box" }), shape("B", { shape: "sphere", radius: 2 })]).scene!;
    const text = writeSceneDataC(scene);
    expect(text).toContain("static const GsCollider colliders[] = {\n  { 0, 0, { 2048, 2048, 2048 } },\n  { 1, 0, { 8192, 0, 0 } }\n};");
    expect(text).toContain("  0, 0, 2, /* sound, audio player, collider counts */\n  0, 0, 0, 0, /* animation player, animation, track, key counts */");
    expect(text).toContain("audioPlayers, colliders, animationPlayers, animations, animTracks, animKeys\n};");
    expect(text).toMatch(/\{ 0, 0, 1, -1, 0, -1, \{ 0, 0, 0 \}/); // shape A is collider 0
    // A scene with none has the placeholder entry, since C does not allow an empty array.
    const none = translateScene3D(scriptedProject([{ source: "func _ready():\n    pass\n" }])).scene!;
    expect(writeSceneDataC(none)).toContain("static const GsCollider colliders[] = {\n  { 0, 0, { 0, 0, 0 } }\n};");
  });

  it("compiles overlaps(a, b) to a call with the two node-table indices", () => {
    const scene = translate(CHECK, [shape("A", { shape: "box" }), shape("B", { shape: "sphere" })]).scene!;
    const index = (name: string) => scene.nodes.findIndex((n) => n.name === name);
    expect(scene.scriptCode).toContain(`gs_overlaps(${index("A")}, ${index("B")})`);
  });

  it("compiles overlaps on self for a script attached to a shape", () => {
    const scene = translate("func _process(delta):\n    if overlaps($B):\n        pass\n", [shape("A", { shape: "box" }), shape("B", { shape: "sphere" })], ["A"]).scene!;
    expect(scene.scriptCode).toMatch(/gs_overlaps\(gss0_self\[inst\], \d+\)/);
  });

  it("does not make a shape dynamic just because a script names it in overlaps()", () => {
    const scene = translate(CHECK, [shape("A", { shape: "box" }), shape("B", { shape: "sphere" })]).scene!;
    expect(scene.nodes.filter((n) => n.name === "A" || n.name === "B").map((n) => n.dynamic)).toEqual([false, false]);
  });

  it("makes a shape dynamic when a script moves it, or the node it is under", () => {
    const moved = translate("func _process(delta):\n    $A.position.x += 1.0\n    if $A.overlaps($B):\n        pass\n", [shape("A"), shape("B")]).scene!;
    expect(moved.nodes.find((n) => n.name === "A")!.dynamic).toBe(true);
    const holder = createSceneNode({ name: "Holder", kind: "Node3D", children: [shape("A")] });
    const under = translate("func _process(delta):\n    $Holder.position.x += 1.0\n    if $A.overlaps($B):\n        pass\n", [holder, shape("B")]).scene!;
    expect(under.nodes.find((n) => n.name === "A")!.dynamic).toBe(true);
    expect(under.nodes.find((n) => n.name === "B")!.dynamic).toBe(false);
  });
});

describe("diagnostics for collision shapes", () => {
  it("warns about a shape no script passes to overlaps(), naming it", () => {
    const r = translate(CHECK, [shape("A"), shape("B"), shape("Lonely")]);
    expect(r.diagnostics).toEqual([
      { severity: "warning", code: "collision-shape-unused", nodeName: "Lonely", message: "No script passes this collision shape to overlaps() or moves it as a body with move_and_collide(), so it does nothing in the game." }
    ]);
    expect(r.scene).not.toBeNull();
  });

  it("warns about every shape when there is no script at all", () => {
    const r = translateScene3D(scriptedProject([], [shape("A"), shape("B")]));
    expect(r.diagnostics.map((d) => [d.code, d.nodeName])).toEqual([["collision-shape-unused", "A"], ["collision-shape-unused", "B"]]);
  });

  it("counts a script attached to the shape itself, calling overlaps on self", () => {
    const r = translate("func _process(delta):\n    if overlaps($B):\n        pass\n", [shape("A"), shape("B")], ["A"]);
    expect(r.diagnostics).toEqual([]);
  });

  it("keeps a hidden shape that a script names, hidden, so the script can show it", () => {
    const hiddenShape = shape("A", { shape: "sphere" });
    hiddenShape.visible = false;
    const r = translate(CHECK, [hiddenShape, shape("B")]);
    const node = r.scene!.nodes.find((n) => n.name === "A")!;
    expect(node.visible).toBe(false);
    expect(node.collider).toBeGreaterThanOrEqual(0);
  });

  it("leaves out a hidden shape no script mentions, without a warning", () => {
    const hiddenShape = shape("Off");
    hiddenShape.visible = false;
    const r = translate(CHECK, [shape("A"), shape("B"), hiddenShape]);
    expect(r.scene!.nodes.some((n) => n.name === "Off")).toBe(false);
    expect(r.diagnostics).toEqual([]);
  });

  it("stops the build for overlaps() on something that is not a shape, naming the script, line and column", () => {
    const r = translate("func _process(delta):\n    if $Cube.overlaps($B):\n        pass\n", [shape("B")]);
    expect(r.scene).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "script-error")!.message).toMatch(/^line 2, column 14: overlaps\(\) works on CollisionShape3D nodes, but \$Cube is a MeshInstance3D/);
  });
});
