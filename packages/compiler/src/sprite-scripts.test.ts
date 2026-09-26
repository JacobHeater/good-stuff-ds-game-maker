import { createSceneNode, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeWithSpritesProject } from "./fixtures";
import { writeSceneDataC, writeScriptCodeC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.script-and-rotate-2d-nodes.md */

const F = 4096;

function withSprites(sprites: SceneNode[], source?: string, attachTo: string[] = []): ProjectSnapshot {
  const base = cubeWithSpritesProject();
  // A script runs only where it is attached: to the sprites named in attachTo, or else to the cube (which then reaches the sprites by name).
  const kept = base.scene.children.filter((n) => n.kind !== "Sprite2D").map((n) => (source && attachTo.length === 0 && n.name === "Cube" ? { ...n, scriptId: "s" } : n));
  const scene = { ...base.scene, children: [...kept, ...sprites.map((s) => (attachTo.includes(s.name) ? { ...s, scriptId: "s" } : s))] };
  const project: ProjectSnapshot = { ...base, scene };
  return source ? { ...project, scripts: [{ id: "s", name: "Turn", source }] } : project;
}
const sprite = (name: string, extra: Partial<SceneNode> = {}): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", screen: "bottom", position: { x: 100, y: 80 } }), spriteId: "spr-diamond", ...extra });
const spinner = "func _process(delta):\n    rotation += 90.0 * delta\n    position.x += 10.0 * delta\n";

describe("scripted and rotating sprites", () => {
  it("a sprite a script turns follows its node every frame and has a rotation matrix; the corner is that of the doubled box", () => {
    const { scene, diagnostics } = translateScene3D(withSprites([sprite("Hero")], spinner, ["Hero"]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const [hero] = scene!.sprites2D.sprites;
    expect(hero).toMatchObject({ name: "Hero", dynamic: true, affine: 0, rotation: 0, scaleX: F, scaleY: F });
    // The diamond is 16 x 16 and centered on (100, 80): a doubled 32 x 32 box starts a whole picture size (16) up and left of the center.
    expect([hero.x, hero.y]).toEqual([84, 64]);
    expect(hero.node).toBeGreaterThanOrEqual(0);
  });

  it("the node state holds x, y, the angle in the third rotation slot, and the scale", () => {
    const rotated = sprite("Hero", { transform2D: { rotation: 30, scale: { x: 2, y: -1 } } });
    const { scene } = translateScene3D(withSprites([rotated], spinner, ["Hero"]));
    const node = scene!.nodes[scene!.sprites2D.sprites[0].node!];
    expect(node.position).toEqual([100 * F, 80 * F, 0]);
    expect(node.rotation).toEqual([0, 0, 30 * F]);
    expect(node.scale).toEqual([2 * F, -1 * F, F]);
    expect(scene!.sprites2D.sprites[0]).toMatchObject({ rotation: 30 * F, scaleX: 2 * F, scaleY: -1 * F });
  });

  it("a static sprite that starts rotated or scaled has a matrix but is not followed; an upright static one has neither", () => {
    const { scene } = translateScene3D(withSprites([sprite("Turned", { transform2D: { rotation: 45 } }), sprite("Plain", { position: { x: 200, y: 50 } })]));
    const [plain, turned] = scene!.sprites2D.sprites; // hardware order: the later node first
    expect(turned).toMatchObject({ name: "Turned", dynamic: false, affine: 0, rotation: 45 * F });
    expect(plain).toMatchObject({ name: "Plain", dynamic: false, affine: -1 });
    expect([plain.x, plain.y]).toEqual([192, 42]); // the corner of the picture itself: (200, 50) less half of 16
  });

  it("a sprite that a script only moves is followed and also gets a matrix (the compiler does not tell a move from a turn)", () => {
    const { scene } = translateScene3D(withSprites([sprite("Hero")], "func _process(delta):\n    $Hero.position.x = 30.0\n"));
    expect(scene!.sprites2D.sprites[0]).toMatchObject({ dynamic: true, affine: 0 });
  });

  it("a hidden sprite a script can show is kept, and a hidden one no script reaches is left out", () => {
    const shown = translateScene3D(withSprites([sprite("Hidden", { visible: false })], "func _process(delta):\n    $Hidden.visible = true\n"));
    expect(shown.scene!.sprites2D.sprites).toHaveLength(1);
    expect(shown.scene!.nodes[shown.scene!.sprites2D.sprites[0].node!].visible).toBe(false); // it starts hidden
    expect(translateScene3D(withSprites([sprite("Hidden", { visible: false })])).scene!.sprites2D.sprites).toHaveLength(0);
  });

  it("is written into the scene data: node, follow flag, matrix, and the starting angle and scale", () => {
    const { scene } = translateScene3D(withSprites([sprite("Hero", { transform2D: { rotation: 90 } })], spinner, ["Hero"]));
    const text = writeSceneDataC(scene!);
    expect(text).toMatch(/\{ 84, 64, 0, \d+, 1, 0, 368640, 4096, 4096, -1, 0, 0 \}/);
    expect(writeScriptCodeC(scene!)).toMatch(/rotation\[2\]/);
  });

  it("a scripted sprite's rotation is compiled as the node state's third rotation slot", () => {
    const { scene } = translateScene3D(withSprites([sprite("Hero")], "func _process(delta):\n    $Hero.rotation = 45.0\n    $Hero.scale.y = 2.0\n    $Hero.visible = false\n"));
    const code = writeScriptCodeC(scene!);
    expect(code).toMatch(/gs_node_state\[\d+\]\.rotation\[2\] = /);
    expect(code).toMatch(/gs_node_state\[\d+\]\.scale\[1\] = /);
    expect(code).toMatch(/gs_node_state\[\d+\]\.visible = /);
  });

  it("more than 32 rotating sprites on the screen is an error, saying how many there are", () => {
    const many = Array.from({ length: 33 }, (_, i) => sprite(`S${i}`, { transform2D: { rotation: 10 } }));
    const { scene, diagnostics } = translateScene3D(withSprites(many));
    expect(scene).toBeNull();
    expect(diagnostics.find((d) => d.code === "too-many-rotating-sprites")!.message).toMatch(/33 sprites that rotate or scale.*32 rotation matrices/);
    expect(translateScene3D(withSprites(many.slice(0, 32))).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a sprite off the screen is kept when it can turn or a script can move it", () => {
    const away = { position: { x: 900, y: 50 } };
    expect(translateScene3D(withSprites([sprite("Gone", away)])).scene!.sprites2D.sprites).toHaveLength(0);
    expect(translateScene3D(withSprites([sprite("Gone", { ...away, transform2D: { rotation: 20 } })])).scene!.sprites2D.sprites).toHaveLength(1);
    expect(translateScene3D(withSprites([sprite("Gone", away)], "func _process(delta):\n    $Gone.position.x = 100.0\n")).scene!.sprites2D.sprites).toHaveLength(1);
  });
});
