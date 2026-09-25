import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { scriptedProject } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/collision/STORY.solid-shapes-and-move-and-collide.md (the part that needs no toolchain) */

const ORIGIN = { x: 0, y: 0, z: 0 };
function shape(name: string, collision: SceneNode["collision"] = {}, position = ORIGIN): SceneNode {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });
  node.collision = collision;
  return node;
}
const mesh = (name: string, children: SceneNode[] = [], position = ORIGIN): SceneNode =>
  createSceneNode({ name, kind: "MeshInstance3D", mesh: "cube", children, transform3D: { position, rotation: { ...ORIGIN }, scale: { x: 1, y: 1, z: 1 } } });

/** A player mesh with a shape under it, a solid floor, and a script (attached to the player) with the given `_process` body. */
const game = (body: string, extra: SceneNode[] = [shape("Floor", { solid: true })], attachTo = ["Player"]) =>
  translateScene3D(scriptedProject([{ name: "Body", source: `func _process(delta):\n${body}`, attachTo }], [mesh("Player", [shape("PlayerShape")]), ...extra]));
const codes = (r: ReturnType<typeof game>) => r.diagnostics.map((d) => `${d.code}${d.nodeName ? `:${d.nodeName}` : ""}`);

describe("solid shapes in the scene description", () => {
  it("writes the solid flag into the collider and the generated C", () => {
    const r = game("    move_and_collide(0.0, -0.1, 0.0)\n", [shape("Floor", { solid: true, shape: "box", size: { x: 4, y: 1, z: 4 } }), shape("Air")]);
    expect(r.scene!.colliders.map((c) => c.solid)).toEqual([false, true, false]);
    expect(writeSceneDataC(r.scene!)).toContain("{ 0, 1, { 8192, 2048, 8192 } }");
  });

  it("compiles move_and_collide to a runtime call with the node index and three floats, and is_on_floor to a state query", () => {
    const r = game("    move_and_collide(0.0, velocity * 2, 1)\n    if is_on_floor():\n        pass\n    if is_on_wall() or $Player.is_on_ceiling():\n        pass\n".replace("velocity * 2", "-0.5"));
    const code = r.scene!.scriptCode;
    expect(code).toMatch(/gs_move_and_collide\(gss0_self\[inst\], 0, \(-2048\), 4096\)/);
    expect(code).toContain("gs_body_state(gss0_self[inst], GS_BODY_FLOOR)");
    expect(code).toContain("gs_body_state(gss0_self[inst], GS_BODY_WALL)");
    const player = r.scene!.nodes.findIndex((n) => n.name === "Player");
    expect(code).toContain(`gs_body_state(${player}, GS_BODY_CEILING)`);
  });

  it("makes the body dynamic (with its shapes), but not the solid ground", () => {
    const r = game("    move_and_collide(0.0, -0.1, 0.0)\n");
    const dynamic = (name: string) => r.scene!.nodes.find((n) => n.name === name)!.dynamic;
    expect([dynamic("Player"), dynamic("PlayerShape"), dynamic("Floor")]).toEqual([true, true, false]);
  });

  it("makes another body dynamic when a script moves it by name", () => {
    const r = game("    $Other.move_and_collide(0.1, 0.0, 0.0)\n", [shape("Floor", { solid: true }), mesh("Other", [shape("OtherShape")])]);
    expect(r.scene!.nodes.find((n) => n.name === "Other")!.dynamic).toBe(true);
    expect(r.scene!.nodes.find((n) => n.name === "Player")!.dynamic).toBe(false);
  });
});

describe("what the compiler says about shapes used by move_and_collide", () => {
  it("counts a body's shapes and every solid shape as used, so there is nothing to warn about", () => {
    expect(codes(game("    move_and_collide(0.0, -0.1, 0.0)\n"))).toEqual([]);
  });

  it("still warns about a shape that is neither solid nor under a moved body", () => {
    expect(codes(game("    move_and_collide(0.0, -0.1, 0.0)\n", [shape("Floor", { solid: true }), shape("Idle")]))).toEqual(["collision-shape-unused:Idle"]);
  });

  it("warns that a solid shape stops nothing when no script moves a body", () => {
    const r = game("    pass\n");
    expect(codes(r)).toEqual(["collision-shape-unused:PlayerShape", "collision-shape-unused:Floor"]);
    expect(r.diagnostics.find((d) => d.nodeName === "Floor")!.message).toMatch(/This solid shape stops nothing/);
  });

  it("is an error to move a node with no shape under it, naming the script, line and column", () => {
    const r = translateScene3D(scriptedProject([{ name: "Body", source: "func _process(delta):\n    move_and_collide(0.0, -0.1, 0.0)\n" }], [shape("Floor", { solid: true })]));
    expect(r.scene).toBeNull();
    expect(r.diagnostics.find((d) => d.code === "script-error")!.message).toMatch(/^line 2, column 5: move_and_collide\(\) needs a node with a collision shape under it, and this script is attached to Cube, which has none/);
  });
});
