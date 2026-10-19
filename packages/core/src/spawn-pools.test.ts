import { describe, expect, it } from "vitest";

import { createProjectSnapshot, type ProjectSnapshot } from "./project-snapshot";
import { DEFAULT_START_SCENE_ID, expandSceneInstances, expandSpawnPools, nestedSpawnPools, spawnPoolWouldNest, withSceneEntries } from "./project-scenes";
import { createSceneNode, flattenSceneTreeInOrder, type SceneNode } from "./scene-node";
import { clampSpawnPoolCount, isSpawnPool, SPAWN_POOL_COUNT_MAX, SPAWN_POOL_COUNT_MIN } from "./spawn-pool";

/** requirements/scene-designer/STORY.spawn-pools.md */

const sprite = (name: string, id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ ...createSceneNode({ name, kind: "Sprite2D", position: { x: 1, y: 2 } }), id, ...extra });
const tree = (name: string, id: string, children: SceneNode[] = []): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", children }), id });
const instance = (name: string, id: string, of: string, x = 50, y = 60): SceneNode => ({ ...createSceneNode({ name, kind: "Node2D", position: { x, y } }), id, instanceOf: of });
const pool = (name: string, id: string, of: string, count: number, x = 50, y = 60): SceneNode => ({ ...instance(name, id, of, x, y), spawnPoolCount: count });

/** A project of a start scene "Level" (holding the nodes given) and a "Campfire" scene: a root with two sprites (so a pool copy's own subtree has more than one node). */
function world(levelChildren: SceneNode[], extraScenes: ReadonlyArray<{ id: string; name: string; scene: SceneNode; isStart?: boolean }> = []): ProjectSnapshot {
  const campfire = tree("CampfireRoot", "c-root", [sprite("Flame", "c-flame"), sprite("Glow", "c-glow")]);
  const base = createProjectSnapshot({ name: "P", mode: "2D", scene: tree("Main", "l-root", levelChildren) });
  return withSceneEntries(base, [
    { id: DEFAULT_START_SCENE_ID, name: "Level", scene: base.scene, isStart: true },
    { id: "campfire", name: "Campfire", scene: campfire, isStart: false },
    ...extraScenes.map((entry) => ({ ...entry, isStart: false }))
  ]);
}

describe("spawn-pool constants/helpers (spawn-pool.ts)", () => {
  it("clamps a pool count to 1..SPAWN_POOL_COUNT_MAX, leaving undefined as undefined", () => {
    expect(clampSpawnPoolCount(undefined)).toBeUndefined();
    expect(clampSpawnPoolCount(0)).toBe(SPAWN_POOL_COUNT_MIN);
    expect(clampSpawnPoolCount(-5)).toBe(SPAWN_POOL_COUNT_MIN);
    expect(clampSpawnPoolCount(1000)).toBe(SPAWN_POOL_COUNT_MAX);
    expect(clampSpawnPoolCount(3.6)).toBe(4);
  });

  it("isSpawnPool is true only for an instance with more than one copy", () => {
    expect(isSpawnPool({ instanceOf: "x" })).toBe(false); // ordinary instance, no count at all
    expect(isSpawnPool({ instanceOf: "x", spawnPoolCount: 1 })).toBe(false);
    expect(isSpawnPool({ instanceOf: "x", spawnPoolCount: 2 })).toBe(true);
    expect(isSpawnPool({ spawnPoolCount: 5 })).toBe(false); // no instanceOf: not an instance at all
  });
});

describe("expanding spawn pools (expandSpawnPools)", () => {
  it("replaces a pool node with N hidden sibling instance nodes, each otherwise identical", () => {
    const project = world([pool("Campfires", "p1", "campfire", 3, 10, 20)]);
    const { tree: expanded, pools } = expandSpawnPools(project, project.scene);
    expect(expanded.children.map((n) => n.id)).toEqual(["p1/0", "p1/1", "p1/2"]);
    for (const copy of expanded.children) {
      expect(copy).toMatchObject({ name: "Campfires", instanceOf: "campfire", visible: false, position: { x: 10, y: 20 } });
      expect(copy.spawnPoolCount).toBeUndefined(); // consumed: each copy is now an ordinary instance node
    }
    expect(pools).toEqual([{ poolNodeId: "p1", name: "Campfires", sourceSceneId: "campfire", screen: "top", copyRootIds: ["p1/0", "p1/1", "p1/2"] }]);
  });

  it("forces every copy hidden even when the authored pool node was itself visible", () => {
    const authored = pool("Campfires", "p1", "campfire", 2);
    expect(authored.visible).toBe(true); // createSceneNode's own default
    const { tree: expanded } = expandSpawnPools(world([authored]), world([authored]).scene);
    expect(expanded.children.every((n) => n.visible === false)).toBe(true);
  });

  it("leaves an ordinary instance (no pool count, or exactly 1) completely alone", () => {
    const project = world([instance("Hero", "i1", "campfire")]);
    const { tree: expanded, pools } = expandSpawnPools(project, project.scene);
    expect(expanded).toBe(project.scene); // unchanged, same reference
    expect(pools).toEqual([]);
    const projectOfOne = world([pool("Hero", "i1", "campfire", 1)]);
    expect(expandSpawnPools(projectOfOne, projectOfOne.scene).pools).toEqual([]);
  });

  it("doesn't expand into a template's own subtree -- that's left to expandSceneInstances, run next", () => {
    const project = world([pool("Campfires", "p1", "campfire", 2)]);
    const { tree: expanded } = expandSpawnPools(project, project.scene);
    expect(expanded.children[0].children).toEqual([]); // still a plain, unexpanded instance node
  });

  it("a pool alongside ordinary siblings only replaces its own single slot in the parent's children", () => {
    const project = world([sprite("Before", "b"), pool("Campfires", "p1", "campfire", 2), sprite("After", "a")]);
    const { tree: expanded } = expandSpawnPools(project, project.scene);
    expect(expanded.children.map((n) => n.id)).toEqual(["b", "p1/0", "p1/1", "a"]);
  });

  it("leaves a nested pool (its own target scene already contains a pool) alone, not expanded", () => {
    const inner = tree("InnerRoot", "in-root", [pool("InnerPool", "ip", "campfire", 2)]);
    const project = world([pool("OuterPool", "op", "holder", 2)], [{ id: "holder", name: "Holder", scene: inner, isStart: false }]);
    const { tree: expanded, pools } = expandSpawnPools(project, project.scene);
    expect(expanded.children[0]).toMatchObject({ id: "op", instanceOf: "holder" }); // untouched: still the original pool node, not expanded
    expect(pools).toEqual([]);
  });
});

describe("nested spawn pools are refused (spawnPoolWouldNest/nestedSpawnPools)", () => {
  it("detects a pool whose own target scene directly contains another pool", () => {
    const inner = tree("InnerRoot", "in-root", [pool("InnerPool", "ip", "campfire", 2)]);
    const project = world([pool("OuterPool", "op", "holder", 2)], [{ id: "holder", name: "Holder", scene: inner, isStart: false }]);
    expect(spawnPoolWouldNest(project, "holder")).toBe(true);
    expect(nestedSpawnPools(project, project.scene).map((n) => n.name)).toEqual(["OuterPool"]);
  });

  it("detects a pool whose target scene contains a pool only through its own (ordinary) instance", () => {
    const innermost = tree("InnermostRoot", "im-root", [pool("DeepPool", "dp", "campfire", 2)]);
    const middle = tree("MiddleRoot", "mid-root", [instance("Mid", "mid", "innermost")]);
    const project = world([pool("OuterPool", "op", "middle", 2)], [
      { id: "middle", name: "Middle", scene: middle, isStart: false },
      { id: "innermost", name: "Innermost", scene: innermost, isStart: false }
    ]);
    expect(spawnPoolWouldNest(project, "middle")).toBe(true);
  });

  it("is false for an ordinary pool whose target scene has no pool of its own", () => {
    const project = world([pool("Campfires", "p1", "campfire", 2)]);
    expect(spawnPoolWouldNest(project, "campfire")).toBe(false);
    expect(nestedSpawnPools(project, project.scene)).toEqual([]);
  });

  it("doesn't loop forever on a cycle of ordinary instances", () => {
    const a = tree("ARoot", "a-root", [instance("ToB", "to-b", "b")]);
    const b = tree("BRoot", "b-root", [instance("ToA", "to-a", "a")]);
    const project = world([pool("P", "p1", "a", 2)], [
      { id: "a", name: "A", scene: a, isStart: false },
      { id: "b", name: "B", scene: b, isStart: false }
    ]);
    expect(spawnPoolWouldNest(project, "a")).toBe(false); // cyclic, but never actually contains a pool
  });
});

describe("expandSpawnPools then expandSceneInstances expands every copy's own subtree", () => {
  it("each copy's own id-renamed subtree matches, via expandSceneInstances run on expandSpawnPools's own output", () => {
    const project = world([pool("Campfires", "p1", "campfire", 2)]);
    const { tree: afterPools } = expandSpawnPools(project, project.scene);
    const fullyExpanded = expandSceneInstances(project, afterPools);
    const ids = flattenSceneTreeInOrder(fullyExpanded).map((n) => n.id);
    expect(ids).toEqual(["l-root", "p1/0", "p1/0/c-flame", "p1/0/c-glow", "p1/1", "p1/1/c-flame", "p1/1/c-glow"]);
  });
});
