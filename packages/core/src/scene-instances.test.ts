import { describe, expect, it } from "vitest";

import { createProjectSnapshot, type ProjectSnapshot } from "./project-snapshot";
import { danglingInstances, DEFAULT_START_SCENE_ID, expandSceneInstances, instanceWouldCycle, outerNodeId, withSceneEntries } from "./project-scenes";
import { createSceneNode, flattenSceneTree, flattenSceneTreeInOrder, type SceneNode } from "./scene-node";

/** requirements/scene-designer/STORY.scene-instances.md */

const sprite = (name: string, id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", position: { x: 1, y: 2 } }), id, ...extra });
const tree = (name: string, id: string, children: SceneNode[] = []): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", children }), id });
const instance = (name: string, id: string, of: string, x = 50, y = 60): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", position: { x, y } }), id, instanceOf: of });

/** A project of a start scene "Level" (holding the instances given) and a "Player" scene: a root with a sprite, an animated sprite and a script. */
function world(levelChildren: SceneNode[]): ProjectSnapshot {
  const player = tree("PlayerRoot", "p-root", [sprite("Body", "p-body"), sprite("Hat", "p-hat", { scriptId: "s1" })]);
  const base = createProjectSnapshot({ name: "P", mode: "2D", scene: tree("Main", "l-root", levelChildren) });
  return withSceneEntries(base, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: base.scene, isStart: true },
    { id: "player", name: "Player", scene: player, isStart: false }
  ]);
}

describe("expanding scene instances", () => {
  it("replaces an instance with the scene's tree, under the instance's own name and place", () => {
    const project = world([instance("Hero", "i1", "player", 100, 90)]);
    const expanded = expandSceneInstances(project, project.scene);
    const hero = expanded.children[0];
    expect(hero).toMatchObject({ id: "i1", name: "Hero", kind: "Node2D", position: { x: 100, y: 90 }, instanceOf: "player" });
    expect(hero.children.map((n) => n.name)).toEqual(["Body", "Hat"]);
    // the sprite is at (1, 2) in the Player scene (whose root is at 0, 0): the instance at (100, 90) puts it at (101, 92)
    expect(hero.children[0]).toMatchObject({ kind: "Sprite2D", position: { x: 101, y: 92 } });
  });

  it("gives the nodes inside ids of their own for each instance, so two instances of one scene don't clash", () => {
    const project = world([instance("A", "i1", "player"), instance("B", "i2", "player", 10, 10)]);
    const ids = flattenSceneTreeInOrder(expandSceneInstances(project, project.scene)).map((n) => n.id);
    expect(ids).toEqual(["l-root", "i1", "i1/p-body", "i1/p-hat", "i2", "i2/p-body", "i2/p-hat"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the scene's scripts (an instance's own script wins over the root's)", () => {
    const project = world([instance("A", "i1", "player")]);
    expect(flattenSceneTree(expandSceneInstances(project, project.scene)).find((n) => n.name === "Hat")!.scriptId).toBe("s1");
    const own: SceneNode = { ...instance("B", "i2", "player"), scriptId: "mine" };
    expect(expandSceneInstances(world([own]), world([own]).scene).children[0].scriptId).toBe("mine");
  });

  it("follows the source scene live: change the Player scene and every instance changes", () => {
    const project = world([instance("A", "i1", "player")]);
    const changed: ProjectSnapshot = { ...project, scenes: [{ ...project.scenes![0], scene: tree("PlayerRoot", "p-root", [sprite("Only", "p-only")]) }] };
    expect(expandSceneInstances(changed, changed.scene).children[0].children.map((n) => n.name)).toEqual(["Only"]);
  });

  it("expands an instance inside an instance", () => {
    const project = world([instance("A", "i1", "player")]);
    const inner: SceneNode = tree("PlayerRoot", "p-root", [sprite("Body", "p-body"), instance("Pet", "pet", "pet-scene", 5, 5)]);
    const nested: ProjectSnapshot = {
      ...project,
      scenes: [{ ...project.scenes![0], scene: inner }, { id: "pet-scene", name: "Pet", scene: tree("PetRoot", "pt", [sprite("Tail", "tail")]), isStart: false } as never]
    };
    const ids = flattenSceneTreeInOrder(expandSceneInstances(nested, nested.scene)).map((n) => n.id);
    expect(ids).toEqual(["l-root", "i1", "i1/p-body", "i1/pet", "i1/pet/tail"]);
  });

  it("turns an instance of a missing scene, or of a scene that contains itself, into an empty node instead of looping", () => {
    const missing = world([instance("A", "i1", "nope")]);
    expect(expandSceneInstances(missing, missing.scene).children[0].children).toEqual([]);
    expect(danglingInstances(missing, missing.scene).map((n) => n.name)).toEqual(["A"]);
    const loop = world([instance("A", "i1", "player")]);
    const cyclic: ProjectSnapshot = { ...loop, scenes: [{ ...loop.scenes![0], scene: tree("PlayerRoot", "p-root", [instance("Again", "again", "player")]) }] };
    const expanded = expandSceneInstances(cyclic, cyclic.scene);
    expect(flattenSceneTree(expanded).length).toBeLessThan(10);
  });

  it("returns a tree with no instances as it is, and leaves the original tree alone", () => {
    const project = world([sprite("Plain", "x")]);
    expect(expandSceneInstances(project, project.scene)).toBe(project.scene);
    const withInstance = world([instance("A", "i1", "player")]);
    expandSceneInstances(withInstance, withInstance.scene);
    expect(withInstance.scene.children[0].children).toEqual([]);
  });

  it("finds the instance a node inside it belongs to, and refuses a scene that would contain itself", () => {
    expect(outerNodeId("i1/p-body")).toBe("i1");
    expect(outerNodeId("i1/pet/tail")).toBe("i1");
    expect(outerNodeId("plain")).toBe("plain");
    const project = world([instance("A", "i1", "player")]);
    expect(instanceWouldCycle(project, "player", "player")).toBe(true); // into itself
    expect(instanceWouldCycle(project, "player", DEFAULT_START_SCENE_ID)).toBe(true); // Level already holds Player, so Player can't hold Level
    expect(instanceWouldCycle(project, DEFAULT_START_SCENE_ID, "player")).toBe(false);
  });
});
