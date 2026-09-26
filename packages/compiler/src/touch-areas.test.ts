import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, createProjectSnapshot, withThreeDScreen, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { scriptedProject } from "./fixtures";
import { writeSceneDataC, writeScriptCodeC } from "./scene-data-writer";
import { translateScene2D } from "./translate-scene-2d";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/touch/TASK.compile-touch-areas.md */

const button = (extra: Partial<SceneNode> = {}): SceneNode => ({
  ...createSceneNode({ name: "Button", kind: "TouchArea2D", screen: "bottom", position: { x: 192, y: 48 } }),
  touchArea2D: { width: 64, height: 48 },
  ...extra
});
const pick = (extra: Partial<SceneNode> = {}): SceneNode => ({
  ...createSceneNode({ name: "Pick", kind: "TouchArea3D", transform3D: { scale: { x: 2, y: 1, z: 1 } } }),
  touchArea3D: { shape: "box", size: { x: 1, y: 2, z: 3 } },
  ...extra
});
const ASKS_BOTH = "func _process(delta):\n    if $Button.is_touched() or $Pick.is_touch_pressed():\n        position.x = 1.0\n";
const project = (nodes: SceneNode[], source = ASKS_BOTH): ProjectSnapshot => scriptedProject([{ source }], nodes);
const codes = (p: ProjectSnapshot): string[] => translateScene3D(p).diagnostics.map((d) => d.code);

describe("compiling touch areas", () => {
  it("puts a TouchArea2D in as a rectangle in screen pixels and a TouchArea3D as a volume in the DS's numbers, and links each node to its area", () => {
    const { scene, diagnostics } = translateScene3D(project([button(), pick()]));
    expect(diagnostics.filter((d) => d.code !== "touch-area-not-touchable")).toEqual([]);
    expect(scene!.touchAreas).toHaveLength(2);
    const [rect, box] = scene!.touchAreas;
    expect(rect).toMatchObject({ shape: "rect", rect: [160, 24, 64, 48], params: [0, 0, 0] });
    // A box's params are half extents in 20.12 (1 = 4096): 0.5, 1 and 1.5.
    expect(box).toMatchObject({ shape: "box", params: [2048, 4096, 6144] });
    expect(scene!.nodes[rect.node].name).toBe("Button");
    expect(scene!.nodes[rect.node].touch).toBe(0);
    expect(scene!.nodes[box.node].name).toBe("Pick");
    expect(scene!.nodes[box.node].touch).toBe(1);
    expect(scene!.nodes.filter((n) => n.touch === -1).map((n) => n.name)).not.toContain("Button");
    // The box node's scale is in the node table, where the runtime scales the volume.
    expect(scene!.nodes[box.node].worldScale).toEqual([8192, 4096, 4096]);
  });

  it("a sphere is its radius in the first slot", () => {
    const { scene } = translateScene3D(project([pick({ touchArea3D: { shape: "sphere", radius: 0.75 } })], "func _process(delta):\n    if $Pick.is_touched():\n        pass\n"));
    expect(scene!.touchAreas[0]).toMatchObject({ shape: "sphere", params: [3072, 0, 0] });
  });

  it("turns a touched point into a ray with the camera's field of view: tan(fov / 2) is in the scene", () => {
    const { scene } = translateScene3D(project([button()], "func _process(delta):\n    if $Button.is_touched():\n        pass\n"));
    expect(scene!.camera.tanHalfFov).toBeCloseTo(Math.tan((scene!.camera.fovDegrees * Math.PI) / 360), 9);
    expect(scene!.camera.tanHalfFov).toBeCloseTo(0.4663, 3);
  });

  it("writes the areas, the scene's counts and the field of view as constant data the runtime reads", () => {
    const { scene } = translateScene3D(project([button(), pick({ touchArea3D: { shape: "sphere", radius: 0.5 } })]));
    const text = writeSceneDataC(scene!);
    expect(text).toContain("static const GsTouchArea touchAreas[] = {");
    expect(text).toContain("{ 4, 0, { 160, 24, 64, 48 }, { 0, 0, 0 } }".replace("4", String(scene!.touchAreas[0].node)));
    expect(text).toMatch(/, 2, \{ 0, 0, 0, 0 \}, \{ 2048, 0, 0 \} \}/);
    expect(text).toContain("0.4663");
    expect(text).toContain("2, /* touch area count */");
    expect(text).toMatch(/animKeys, touchAreas, \{ 0, 0, two_d_images, two_d_sprites, 0, two_d_animations, 0, two_d_labels \}, 0, mesh_frames, mesh_animations\n\};/);
    expect(writeSceneDataC(scene!)).toBe(text);
  });

  it("a script's questions become calls into the runtime with the node and which question", () => {
    const { scene } = translateScene3D(project([button(), pick()], "func _process(delta):\n    if $Button.is_touched():\n        pass\n    if $Button.is_touch_pressed():\n        pass\n    if $Pick.is_touch_released():\n        pass\n"));
    const code = writeScriptCodeC(scene!);
    expect(code).toMatch(/gs_touch_state\(\d+, GS_TOUCH_HELD\)/);
    expect(code).toMatch(/gs_touch_state\(\d+, GS_TOUCH_PRESSED\)/);
    expect(code).toMatch(/gs_touch_state\(\d+, GS_TOUCH_RELEASED\)/);
  });

  it("a script on the touch area itself asks it without naming it", () => {
    const built = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "Cam", kind: "Camera3D", transform3D: { position: { x: 0, y: 0, z: 5 } } }), { ...pick(), scriptId: "s" }] }) });
    const { scene, diagnostics } = translateScene3D({ ...built, scripts: [{ id: "s", name: "Own", source: "func _process(delta):\n    if is_touch_pressed():\n        visible = false\n" }] });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.code)).not.toContain("touch-area-unused");
    expect(scene!.touchAreas).toHaveLength(1);
  });

  it("warns about a touch area no script asks, naming it, but still builds", () => {
    const { scene, diagnostics } = translateScene3D(project([button(), pick()], "func _process(delta):\n    if $Button.is_touched():\n        pass\n"));
    expect(scene).not.toBeNull();
    expect(diagnostics.filter((d) => d.code === "touch-area-unused")).toMatchObject([{ severity: "warning", nodeName: "Pick" }]);
  });

  it("warns that a TouchArea2D on the top screen and a TouchArea3D when the 3D scene is on the top screen can never be touched", () => {
    const top = project([button({ screen: "top" }), pick()]);
    const messages = translateScene3D(top).diagnostics.filter((d) => d.code === "touch-area-not-touchable");
    expect(messages.map((d) => d.nodeName).sort()).toEqual(["Button", "Pick"]); // the 3D scene is on the top screen in this fixture
    expect(messages.find((d) => d.nodeName === "Pick")!.message).toMatch(/3D scene is on the top screen/);
    expect(messages.find((d) => d.nodeName === "Button")!.message).toMatch(/top screen, which does not sense the stylus/);
  });

  it("with the 3D scene on the bottom screen a TouchArea3D is fine, and the 2D screen (the top) can't be touched", () => {
    const base = project([button(), pick()]);
    const swapped: ProjectSnapshot = { ...base, scene: withThreeDScreen(base.scene, "bottom") };
    const found = translateScene3D(swapped).diagnostics.filter((d) => d.code === "touch-area-not-touchable");
    expect(found.map((d) => d.nodeName)).toEqual(["Button"]);
  });

  it("leaves out a hidden touch area no script names, and keeps a named one (hidden, so it counts as not touched)", () => {
    expect(translateScene3D(project([button({ visible: false })], "func _process(delta):\n    pass\n")).scene!.touchAreas).toHaveLength(0);
    const named = translateScene3D(project([button({ visible: false })], "func _process(delta):\n    if $Button.is_touched():\n        pass\n")).scene!;
    expect(named.touchAreas).toHaveLength(1);
    expect(named.nodes[named.touchAreas[0].node].visible).toBe(false);
  });

  it("a script asking a node that isn't a touch area stops the build, naming the script line", () => {
    const { scene, diagnostics } = translateScene3D(project([button()], "func _process(delta):\n    if $Cube.is_touched():\n        pass\n"));
    expect(scene).toBeNull();
    expect(diagnostics.find((d) => d.code === "script-error")!.message).toMatch(/line 2.*\$Cube is a MeshInstance3D/);
  });

  it("a 2D project's ROM doesn't run scripts, so a TouchArea2D there is reported as not built", () => {
    const p2 = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [createSceneNode({ name: "B", kind: "TouchArea2D", screen: "bottom" })] }) });
    const { diagnostics, scene } = translateScene2D(p2);
    expect(scene).not.toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "two-d-node-not-built", nodeName: "B" }]);
  });

  it("no touch areas: no diagnostics, and an empty table", () => {
    const { scene, diagnostics } = translateScene3D(scriptedProject([]));
    expect(diagnostics.map((d) => d.code)).not.toContain("touch-area-unused");
    expect(scene!.touchAreas).toEqual([]);
    expect(codes(scriptedProject([]))).not.toContain("touch-area-not-touchable");
  });
});

describe("copying a vector from a touch area", () => {
  it("$Cube.position = $Pick.position copies the three components in the generated C", () => {
    const { scene, diagnostics } = translateScene3D(project([pick()], "func _process(delta):\n    if $Pick.is_touched():\n        $Cube.position = $Pick.position\n"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const code = writeScriptCodeC(scene!);
    const cube = scene!.nodes.findIndex((n) => n.name === "Cube");
    const touch = scene!.nodes.findIndex((n) => n.name === "Pick");
    for (const axis of [0, 1, 2]) expect(code).toContain(`gs_node_state[${cube}].position[${axis}] = gs_node_state[${touch}].position[${axis}];`);
    expect(scene!.nodes[cube].dynamic).toBe(true); // the runtime moves the cube each frame now
  });
});

describe("Input.touch_ground_x / touch_ground_z", () => {
  it("become calls into the runtime with the axis and the plane's height in 20.12", () => {
    const { scene, diagnostics } = translateScene3D(project([pick()], "func _process(delta):\n    if $Pick.is_touched():\n        position.x = Input.touch_ground_x(0.5)\n        position.z = Input.touch_ground_z(position.y)\n"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const code = writeScriptCodeC(scene!);
    expect(code).toContain("gs_touch_ground(0, 2048)");
    expect(code).toMatch(/gs_touch_ground\(1, gs_node_state\[.*\]\.position\[1\]\)/);
  });
});

describe("the Jenga block script (tests/prototypes/scripts/jenga-block.gsscript)", () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "prototypes", "scripts", "jenga-block.gsscript"), "utf-8");

  function jenga(): ProjectSnapshot {
    const touch: SceneNode = { ...createSceneNode({ name: "JengaTouch", kind: "TouchArea3D" }), touchArea3D: { shape: "box", size: { x: 1.2, y: 1.2, z: 1.2 } } };
    const block: SceneNode = { ...createSceneNode({ name: "JengaBlock", kind: "MeshInstance3D", children: [createSceneNode({ name: "JengaCollision", kind: "CollisionShape3D" }), touch] }), scriptId: "jenga" };
    const table: SceneNode = { ...createSceneNode({ name: "Table", kind: "CollisionShape3D", transform3D: { position: { x: 0, y: -1, z: 0 } } }), collision: { solid: true } };
    const camera = createSceneNode({ name: "Cam", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 5 } } });
    const built = createProjectSnapshot({ name: "Jenga", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [camera, table, block, createSceneNode({ name: "Tower", kind: "Node3D" })] }) });
    return { ...built, scripts: [{ id: "jenga", name: "Jenga", source }], scene: withThreeDScreen(built.scene, "bottom") } as ProjectSnapshot;
  }

  it("has no errors (and nothing to warn about: the touch area is asked, the shapes are used)", () => {
    const { scene, diagnostics } = translateScene3D(jenga());
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual([]);
    expect(scene!.touchAreas).toHaveLength(1);
    const code = writeScriptCodeC(scene!);
    expect(code).toContain("gs_touch_ground(0,");
    expect(code).toContain("GS_TOUCH_PRESSED");
    expect(code).toContain("gs_move_and_collide(");
    expect(code).toContain("gs_probe_solid("); // what holds the block up
  });
});

describe("several copies of one block, each with its own touch area", () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "prototypes", "scripts", "jenga-block.gsscript"), "utf-8");

  /** A block the way the editor duplicates it: the copy gets a new name, and what is under it keeps its names. */
  function blocks(count: number): ProjectSnapshot {
    const one = (name: string, x: number): SceneNode => ({
      ...createSceneNode({
        name,
        kind: "MeshInstance3D",
        transform3D: { position: { x, y: 0, z: 0 } },
        children: [createSceneNode({ name: "JengaCollision", kind: "CollisionShape3D" }), { ...createSceneNode({ name: "JengaTouch", kind: "TouchArea3D" }), touchArea3D: { shape: "box", size: { x: 1.2, y: 1.2, z: 1.2 } } }]
      }),
      scriptId: "jenga"
    });
    const table: SceneNode = { ...createSceneNode({ name: "Table", kind: "CollisionShape3D", transform3D: { position: { x: 0, y: -1, z: 0 } } }), collision: { solid: true } };
    const camera = createSceneNode({ name: "Cam", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 5 } } });
    const children = [camera, table, createSceneNode({ name: "Tower", kind: "Node3D" }), ...Array.from({ length: count }, (_, i) => one(i === 0 ? "JengaBlock" : `JengaBlock${i + 1}`, i * 2))];
    const built = createProjectSnapshot({ name: "Jenga", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children }) });
    return { ...built, scripts: [{ id: "jenga", name: "Jenga", source }], scene: withThreeDScreen(built.scene, "bottom") };
  }

  it("compiles with no errors and no warnings, and every copy's script asks that copy's own touch area", () => {
    const { scene, diagnostics } = translateScene3D(blocks(3));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual([]);
    expect(scene!.touchAreas).toHaveLength(3);
    // Three copies of the script (each finds a different child), so three sets of generated code, each asking a different touch area.
    const code = writeScriptCodeC(scene!);
    const asked = [...code.matchAll(/gs_touch_state\((\d+), GS_TOUCH_PRESSED\)/g)].map((m) => Number(m[1]));
    expect(new Set(asked).size).toBe(3);
    expect(asked.sort((a, b) => a - b)).toEqual(scene!.touchAreas.map((t) => t.node).sort((a, b) => a - b));
    for (const index of asked) expect(scene!.nodes[index].name).toBe("JengaTouch");
  });

  it("the copies' touch areas belong to different blocks: each node is under a differently named block", () => {
    const { scene } = translateScene3D(blocks(2));
    const parents = scene!.touchAreas.map((t) => scene!.nodes[scene!.nodes[t.node].parent].name);
    expect(parents).toEqual(["JengaBlock", "JengaBlock2"]);
  });
});
