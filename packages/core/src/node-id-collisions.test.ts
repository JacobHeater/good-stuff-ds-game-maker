import { describe, expect, it } from "vitest";

import { createSceneNode, duplicateSceneNode, ensureNodeIdsAbove } from "./scene-node";

/**
 * The node id counter (scene-node.ts) is a single counter shared by every node kind, that only ever counts up for as long as the app runs. It
 * never knew about ids already saved in a project from an earlier session, so a project opened fresh (the counter starting back at 0) could,
 * after enough nodes were duplicated or added, mint an id that a much earlier session had already used and saved to the file -- two different
 * nodes sharing one id, breaking anything that looks a node up by its id (a scene instance's contents ending up merged into the wrong node's).
 * ensureNodeIdsAbove closes that gap: called with every id already in a project being opened, it makes sure nothing minted afterward can repeat one.
 */

describe("ensureNodeIdsAbove", () => {
  it("makes ids minted afterward higher than any given, even ones from a kind that hasn't been used yet this session", () => {
    ensureNodeIdsAbove(["meshinstance3d-500", "camera3d-501"]);
    const a = createSceneNode({ name: "A", kind: "Node3D" });
    const b = createSceneNode({ name: "B", kind: "Node3D" });
    for (const id of [a.id, b.id]) {
      const n = Number(/-(\d+)$/.exec(id)![1]);
      expect(n).toBeGreaterThan(501);
    }
    expect(a.id).not.toBe(b.id);
  });

  it("never moves the counter backward: a lower watermark given later changes nothing", () => {
    ensureNodeIdsAbove(["node3d-9000"]);
    ensureNodeIdsAbove(["node3d-1"]); // an old, low id shouldn't undo the higher watermark just set
    const n = Number(/-(\d+)$/.exec(createSceneNode({ name: "C", kind: "Node3D" }).id)![1]);
    expect(n).toBeGreaterThan(9000);
  });

  it("ignores ids with no numeric suffix instead of throwing", () => {
    expect(() => ensureNodeIdsAbove(["not-a-generated-id", "", "scene-abcdef12"])).not.toThrow();
  });

  it("a project opened in a fresh session can't produce a duplicate that collides with what it already has, once seeded", () => {
    // Simulates two scenes saved by an earlier session: a "Map" scene whose nodes happen to be numbered right where this (fresh) session's
    // counter would otherwise start counting from, and a "World" scene with a node to duplicate.
    const preExisting = ["meshinstance3d-1", "meshinstance3d-2", "collisionshape3d-3", "node3d-4"];
    ensureNodeIdsAbove(preExisting);
    const original = createSceneNode({ name: "Player", kind: "MeshInstance3D" });
    const clone = duplicateSceneNode(original);
    expect(preExisting).not.toContain(clone.id);
    expect(clone.id).not.toBe(original.id);
  });
});
