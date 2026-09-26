import { createSceneNode, createSpriteFromRgba, DEFAULT_START_SCENE_ID, withSceneEntries, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { translateProject3D } from "./translate-project";
import { translateScene2D } from "./translate-scene-2d";

/** requirements/scene-designer/STORY.scene-instances.md: a scene used inside another scene is built into the ROM. */

const image = (id: string): ImportedSprite => {
  const made = createSpriteFromRgba(new Uint8Array(16 * 16 * 4).fill(255), 16, 16, { name: id });
  if (!made.ok) throw new Error("didn't convert");
  return { id, ...made.sprite };
};
const sprite = (name: string, x: number, y: number): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", screen: "top", position: { x, y } }), spriteId: "i" });
const instance = (name: string, of: string, x: number, y: number): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", screen: "top", position: { x, y } }), instanceOf: of });

function project2D(levelChildren: SceneNode[]): ProjectSnapshot {
  const level = createSceneNode({ name: "Level", kind: "Node2D", children: levelChildren });
  const player = createSceneNode({ name: "Player", kind: "Node2D", children: [sprite("Body", 10, 20)] });
  const base: ProjectSnapshot = { ...cubeProject(), mode: "2D", scene: level, sprites: [image("i")] };
  return withSceneEntries(base, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
    { id: "player", name: "Player", scene: player, isStart: false }
  ]);
}

describe("instances of a scene in a 2D project", () => {
  it("draws the scene once for each instance, each shifted by where its instance is", () => {
    const { scene, diagnostics } = translateScene2D(project2D([instance("A", "player", 100, 50), instance("B", "player", 30, 40)]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // the sprite is a 16 x 16 picture at (10, 20) in the Player scene: centered on its position, so its corner is 8 up and left of it
    expect(scene!.top.sprites.map((s) => [s.x, s.y]).sort()).toEqual([[102, 62], [32, 52]].sort());
  });

  it("draws the scene as it was made when the instance is where the scene's own root is (0, 0)", () => {
    const { scene } = translateScene2D(project2D([instance("A", "player", 0, 0)]));
    expect(scene!.top.sprites.map((s) => [s.x, s.y])).toEqual([[2, 12]]);
  });

  it("changes with the scene: an instance always shows the scene as it is now", () => {
    const base = project2D([instance("A", "player", 0, 0)]);
    const edited: ProjectSnapshot = {
      ...base,
      scenes: [{ ...base.scenes![0], scene: createSceneNode({ name: "Player", kind: "Node2D", children: [sprite("Body", 10, 20), sprite("Hat", 40, 20)] }) }]
    };
    expect(translateScene2D(edited).scene!.top.sprites).toHaveLength(2);
  });

  it("says when an instance's scene is gone, and draws nothing for it", () => {
    const { scene, diagnostics } = translateScene2D(project2D([instance("Ghost", "deleted", 0, 0)]));
    expect(scene!.top.sprites).toEqual([]);
    expect(diagnostics.find((d) => d.code === "scene-instance-missing")).toMatchObject({ severity: "warning", nodeName: "Ghost" });
  });
});

describe("instances of a scene in a 3D project", () => {
  function project3D(): ProjectSnapshot {
    const base = cubeProject();
    const cubeWithScript: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "spin" };
    const enemy: SceneNode = { ...createSceneNode({ name: "Enemy", kind: "Node3D", children: [cubeWithScript] }) };
    const instanceNode: SceneNode = { ...createSceneNode({ name: "Enemy1", kind: "Node3D" }), instanceOf: "enemy" };
    const level: SceneNode = { ...base.scene, children: base.scene.children.filter((n) => n.name !== "Cube").concat(instanceNode) };
    return {
      ...withSceneEntries({ ...base, scene: level }, [
        { id: DEFAULT_START_SCENE_ID, name: "Level", scene: level, isStart: true },
        { id: "enemy", name: "Enemy", scene: enemy, isStart: false }
      ]),
      scripts: [{ id: "spin", name: "Spin", source: "func _process(delta):\n    rotation.y += 90.0 * delta\n" }]
    };
  }

  it("builds the scene's meshes and scripts into the scene that holds the instance", () => {
    const { scenes, diagnostics } = translateProject3D(project3D());
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const level = scenes![0];
    expect(level.meshes.length).toBeGreaterThan(0); // the cube inside the instance is drawn
    expect(level.scriptCode).toContain("rotation[1]"); // and its script runs
    expect(level.nodes.some((n) => n.name === "Enemy1")).toBe(true);
  });
});
