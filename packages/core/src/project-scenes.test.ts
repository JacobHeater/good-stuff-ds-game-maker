import { describe, expect, it } from "vitest";

import { createProjectSnapshot, pruneUnusedAssets, withUpdatedScene, type ProjectSnapshot } from "./project-snapshot";
import {
  DEFAULT_START_SCENE_ID,
  findSceneEntry,
  flattenAllScenes,
  listScenes,
  sceneNamesOf,
  uniqueSceneName,
  withSceneEntries,
  withSceneTree
} from "./project-scenes";
import { createSceneNode } from "./scene-node";

/** requirements/scene-designer/STORY.multiple-scenes.md */

const tree = (name: string, children = [] as ReturnType<typeof createSceneNode>[]) => createSceneNode({ name, kind: "Node2D", children });
const single = (): ProjectSnapshot => createProjectSnapshot({ name: "P", mode: "2D", scene: tree("Main") });
function withTwo(): ProjectSnapshot {
  const project = single();
  return withSceneEntries(project, [
    { id: DEFAULT_START_SCENE_ID, name: "Title", scene: project.scene, isStart: true },
    { id: "s2", name: "Level", scene: tree("Level1"), isStart: false }
  ]);
}

describe("a project's list of scenes", () => {
  it("has one scene, the start, for a project that never had more: named as its root, with the default id, and no multi-scene keys", () => {
    const project = single();
    expect(listScenes(project)).toEqual([{ id: DEFAULT_START_SCENE_ID, name: "Main", scene: project.scene, isStart: true }]);
    expect(Object.keys(withSceneEntries(project, listScenes(project))).sort()).toEqual(Object.keys(project).sort());
  });

  it("lists the start scene first, then the others in order, and names them for scripts", () => {
    const project = withTwo();
    expect(listScenes(project).map((s) => [s.name, s.isStart])).toEqual([["Title", true], ["Level", false]]);
    expect(sceneNamesOf(project)).toEqual(["Title", "Level"]);
    expect(project.sceneName).toBe("Title");
    expect(project.scenes).toHaveLength(1);
    expect(findSceneEntry(project, "s2")!.scene.name).toBe("Level1");
    expect(findSceneEntry(project, "nope")).toBeUndefined();
  });

  it("makes another scene the start by swapping which tree is project.scene", () => {
    const project = withTwo();
    const entries = listScenes(project).map((s) => ({ ...s, isStart: s.id === "s2" }));
    const swapped = withSceneEntries(project, entries);
    expect(swapped.scene.name).toBe("Level1");
    expect(swapped.sceneName).toBe("Level");
    expect(swapped.sceneId).toBe("s2");
    expect(swapped.scenes!.map((s) => s.name)).toEqual(["Title"]);
  });

  it("replaces one scene's tree by id, leaving the others as they were", () => {
    const project = withTwo();
    const edited = tree("Level1", [createSceneNode({ name: "Coin", kind: "Sprite2D" })]);
    const next = withSceneTree(project, "s2", edited);
    expect(next.scenes![0].scene).toBe(edited);
    expect(next.scene).toBe(project.scene);
    expect(withSceneTree(project, "nope", edited)).toBe(project);
    const start = withSceneTree(project, DEFAULT_START_SCENE_ID, edited);
    expect(start.scene).toBe(edited);
    expect(start.sceneName).toBe("Title");
  });

  it("goes back to one plain scene when the others are removed and the name is the root's again", () => {
    const project = withTwo();
    const back = withSceneEntries(project, [{ id: DEFAULT_START_SCENE_ID, name: project.scene.name, scene: project.scene, isStart: true }]);
    expect(back.scenes).toBeUndefined();
    expect(back.sceneName).toBeUndefined();
    expect(back.sceneId).toBeUndefined();
  });

  it("needs a start scene", () => {
    expect(() => withSceneEntries(single(), [{ id: "a", name: "A", scene: tree("A"), isStart: false }])).toThrow(/starting scene/);
  });

  it("gives a new scene a name no scene has, counting on from a trailing number", () => {
    expect(uniqueSceneName(["Main"], "Level")).toBe("Level");
    expect(uniqueSceneName(["Main", "Level"], "Level")).toBe("Level2");
    expect(uniqueSceneName(["Level", "Level2"], "Level")).toBe("Level3");
    expect(uniqueSceneName(["Level2"], "Level2")).toBe("Level3");
    expect(uniqueSceneName([], "   ")).toBe("Scene");
  });

  it("sees the nodes of every scene", () => {
    const project = withTwo();
    expect(flattenAllScenes(project).map((n) => n.name)).toEqual(["Main", "Level1"]);
  });
});

describe("assets used by other scenes are kept", () => {
  it("doesn't drop a sprite image only another scene uses when the edited scene is saved", () => {
    const project = withTwo();
    const coin = createSceneNode({ name: "Coin", kind: "Sprite2D" });
    coin.spriteId = "img";
    const withImage: ProjectSnapshot = {
      ...withSceneTree(project, "s2", tree("Level1", [coin])),
      sprites: [{ id: "img", name: "coin", width: 8, height: 8, palette: "AAA=", pixels: "AA==" }]
    };
    expect(withUpdatedScene(withImage, withImage.scene).sprites).toHaveLength(1);
    expect(pruneUnusedAssets(withImage).sprites).toHaveLength(1);
    const unused = withSceneTree(withImage, "s2", tree("Level1"));
    expect(pruneUnusedAssets(unused).sprites).toBeUndefined();
  });
});
