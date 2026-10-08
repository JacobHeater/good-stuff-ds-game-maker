import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/scene-designer/STORY.script-and-rotate-2d-nodes.md */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Cube", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Hero", kind: "Sprite2D", screen: "bottom" }),
      createSceneNode({ name: "Pick", kind: "TouchArea3D" }),
      createSceneNode({ name: "View", kind: "Camera2D", screen: "bottom" })
    ]
  });
}
const attachedTo = (...kinds: SceneNodeKind[]): ScriptSceneContext["attached"] => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached = attachedTo("Sprite2D")): ScriptCheckResult => checkScript(source, { root: scene(), attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error");
const messages = (r: ScriptCheckResult): string[] => errors(r).map((d) => d.message);

describe("scripts on a Sprite2D", () => {
  it("move, turn, scale and show it: position.x/y, rotation, scale.x/y and visible, bare on the node", () => {
    const r = check("func _process(delta):\n    position.x += 40.0 * delta\n    position.y = 96.0\n    rotation += 90.0 * delta\n    scale.x = 2.0\n    scale.y = scale.x * 0.5\n    visible = rotation < 180.0\n");
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfWritesTransform).toBe(true);
    expect(r.usage.selfWritesVisible).toBe(true);
  });

  it("work on a named sprite from another node's script, and on self with self.", () => {
    const r = check("func _process(delta):\n    $Hero.rotation = $Hero.rotation + 1.0\n    $Hero.position.x = 128.0\n    $Hero.visible = false\n", attachedTo("MeshInstance3D"));
    expect(errors(r)).toEqual([]);
    expect(r.usage.nodeWritesTransform.size).toBe(1);
    expect(errors(check("func _process(delta):\n    self.rotation = 45.0\n    self.position.y = 3.0\n"))).toEqual([]);
  });

  it("annotate rotation as the third rotation slot of the node's state, for the code generator", () => {
    const r = check("func _process(delta):\n    rotation = 10.0\n");
    const statement = r.program.functions[0].body[0] as { target: { res?: { kind: string; prop: string; axis: number } } };
    expect(statement.target.res).toMatchObject({ kind: "nodeAxis", prop: "rotation", axis: 2 });
  });

  it("a 2D node's position and scale have .x and .y only, and its rotation is a single number", () => {
    expect(messages(check("func _process(delta):\n    position.z = 1.0\n"))[0]).toMatch(/2D node's position has \.x and \.y only/);
    expect(messages(check("func _process(delta):\n    var s = scale.z\n"))[0]).toMatch(/2D node's scale has \.x and \.y only/);
    expect(errors(check("func _process(delta):\n    rotation.x = 1.0\n")).length).toBeGreaterThan(0);
  });

  it("a 3D node keeps its 3D members (vectors with .z, a rotation vector)", () => {
    expect(errors(check("func _process(delta):\n    position.z = 1.0\n    rotation.y += 1.0\n", attachedTo("MeshInstance3D")))).toEqual([]);
    expect(errors(check("func _process(delta):\n    rotation = 1.0\n", attachedTo("MeshInstance3D"))).length).toBeGreaterThan(0);
  });

  it("copies a whole vector only between nodes of the same kind", () => {
    expect(messages(check("func _process(delta):\n    $Hero.position = $Cube.position\n", attachedTo("MeshInstance3D")))[0]).toMatch(/2D node's vector can only be copied from another 2D node's/);
    expect(errors(check("func _process(delta):\n    $Cube.position = $Pick.position\n", attachedTo("MeshInstance3D")))).toEqual([]);
  });

  it("other 2D nodes have no such members", () => {
    const root = scene();
    root.children.push(createSceneNode({ name: "Text", kind: "Label", screen: "bottom" }));
    const r = checkScript("func _process(delta):\n    $Text.rotation = 1.0\n", { root, attached: attachedTo("MeshInstance3D") });
    expect(messages(r)[0]).toMatch(/\$Text is a Label, which has no "rotation"/);
  });
});

/** requirements/scene-designer/STORY.standalone-2d-camera.md: a Camera2D only has `position` -- no rotation, scale or visible. */
describe("scripts on a Camera2D", () => {
  it("moves it: position.x/y, bare on the node, named, and with self.", () => {
    const r = check("func _process(delta):\n    position.x += 40.0 * delta\n    position.y = 96.0\n", attachedTo("Camera2D"));
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfWritesTransform).toBe(true);
    expect(errors(check("func _process(delta):\n    $View.position.x = 10.0\n", attachedTo("MeshInstance3D")))).toEqual([]);
    expect(errors(check("func _process(delta):\n    self.position.y = 3.0\n", attachedTo("Camera2D")))).toEqual([]);
  });

  it("has no rotation, scale or visible, unlike a sprite", () => {
    expect(errors(check("func _process(delta):\n    rotation = 1.0\n", attachedTo("Camera2D"))).length).toBeGreaterThan(0);
    expect(errors(check("func _process(delta):\n    scale.x = 1.0\n", attachedTo("Camera2D"))).length).toBeGreaterThan(0);
    expect(errors(check("func _process(delta):\n    visible = false\n", attachedTo("Camera2D"))).length).toBeGreaterThan(0);
  });

  it("its position has .x and .y only", () => {
    expect(messages(check("func _process(delta):\n    position.z = 1.0\n", attachedTo("Camera2D")))[0]).toMatch(/2D node's position has \.x and \.y only/);
  });

  it("can snap to a sprite's position, and a sprite to a camera's (both are 2D vectors)", () => {
    expect(errors(check("func _process(delta):\n    $View.position = $Hero.position\n", attachedTo("MeshInstance3D")))).toEqual([]);
    expect(errors(check("func _process(delta):\n    $Hero.position = $View.position\n", attachedTo("MeshInstance3D")))).toEqual([]);
    expect(messages(check("func _process(delta):\n    $View.position = $Cube.position\n", attachedTo("MeshInstance3D")))[0]).toMatch(/2D node's vector can only be copied from another 2D node's/);
  });
});
