import { describe, expect, it } from "vitest";

import { createSceneNode, moveSceneNodes, topMostNodes, type SceneNode } from "./scene-node";

/** Tree:  Root > [A > [A1, A2], B, C > [C1], D] */
function tree(): { root: SceneNode; by: Record<string, SceneNode> } {
  const n = (name: string, children: SceneNode[] = []): SceneNode => createSceneNode({ name, kind: "Node3D", children });
  const A1 = n("A1");
  const A2 = n("A2");
  const A = n("A", [A1, A2]);
  const B = n("B");
  const C1 = n("C1");
  const C = n("C", [C1]);
  const D = n("D");
  const root = n("Root", [A, B, C, D]);
  return { root, by: { Root: root, A, A1, A2, B, C, C1, D } };
}
/** The tree as text, e.g. "Root(A(A1 A2) B C(C1) D)". */
const shape = (node: SceneNode): string => (node.children.length === 0 ? node.name : `${node.name}(${node.children.map(shape).join(" ")})`);
const ids = (...nodes: SceneNode[]): string[] => nodes.map((node) => node.id);

describe("topMostNodes", () => {
  it("keeps the listed nodes in tree order, without the root and without a node inside another listed one", () => {
    const { root, by } = tree();
    expect(topMostNodes(root, ids(by.D, by.B, by.A)).map((x) => x.name)).toEqual(["A", "B", "D"]);
    expect(topMostNodes(root, ids(by.A1, by.A, by.C1)).map((x) => x.name)).toEqual(["A", "C1"]);
    expect(topMostNodes(root, ids(by.Root, by.B)).map((x) => x.name)).toEqual(["B"]);
    expect(topMostNodes(root, [])).toEqual([]);
  });
});

describe("moveSceneNodes", () => {
  it("moves a node before or after a sibling", () => {
    const { root, by } = tree();
    expect(shape(moveSceneNodes(root, ids(by.D), by.A.id, "before")!)).toBe("Root(D A(A1 A2) B C(C1))");
    expect(shape(moveSceneNodes(root, ids(by.A), by.C.id, "after")!)).toBe("Root(B C(C1) A(A1 A2) D)");
    expect(shape(moveSceneNodes(root, ids(by.B), by.A2.id, "after")!)).toBe("Root(A(A1 A2 B) C(C1) D)");
  });

  it("moves a node inside another as its last child, and takes what is under it along", () => {
    const { root, by } = tree();
    expect(shape(moveSceneNodes(root, ids(by.A), by.C.id, "inside")!)).toBe("Root(B C(C1 A(A1 A2)) D)");
    expect(shape(moveSceneNodes(root, ids(by.B), by.Root.id, "inside")!)).toBe("Root(A(A1 A2) C(C1) D B)");
  });

  it("moves several nodes at once, keeping their order in the tree whatever order they were listed in", () => {
    const { root, by } = tree();
    expect(shape(moveSceneNodes(root, ids(by.D, by.B), by.A1.id, "before")!)).toBe("Root(A(B D A1 A2) C(C1))");
    expect(shape(moveSceneNodes(root, ids(by.A1, by.C1), by.D.id, "after")!)).toBe("Root(A(A2) B C D A1 C1)");
  });

  it("a node listed with its own parent moves with it, not separately", () => {
    const { root, by } = tree();
    expect(shape(moveSceneNodes(root, ids(by.A, by.A1), by.D.id, "after")!)).toBe("Root(B C(C1) D A(A1 A2))");
  });

  it("moving next to a node that is also being moved lands beside the others' new place", () => {
    const { root, by } = tree();
    // B and C are moved and dropped after D: D stays where it is, B and C follow it.
    expect(shape(moveSceneNodes(root, ids(by.B, by.C), by.D.id, "after")!)).toBe("Root(A(A1 A2) D B C(C1))");
  });

  it("refuses a drop into a node's own subtree, onto itself, or beside the root", () => {
    const { root, by } = tree();
    expect(moveSceneNodes(root, ids(by.A), by.A1.id, "inside")).toBeNull();
    expect(moveSceneNodes(root, ids(by.A), by.A.id, "before")).toBeNull();
    expect(moveSceneNodes(root, ids(by.A, by.B), by.A2.id, "after")).toBeNull();
    expect(moveSceneNodes(root, ids(by.B), by.Root.id, "before")).toBeNull();
    expect(moveSceneNodes(root, ids(by.B), by.Root.id, "after")).toBeNull();
  });

  it("returns null when nothing would change, or nothing is listed, or the target is missing", () => {
    const { root, by } = tree();
    expect(moveSceneNodes(root, ids(by.B), by.C.id, "before")).toBeNull(); // B is already just before C
    expect(moveSceneNodes(root, ids(by.C), by.B.id, "after")).toBeNull();
    expect(moveSceneNodes(root, ids(by.D), by.Root.id, "inside")).toBeNull(); // already the last child
    expect(moveSceneNodes(root, [], by.C.id, "before")).toBeNull();
    expect(moveSceneNodes(root, ids(by.Root), by.C.id, "before")).toBeNull();
    expect(moveSceneNodes(root, ids(by.B), "nope", "before")).toBeNull();
  });

  it("can be refused by the caller, per node and new parent", () => {
    const { root, by } = tree();
    const noUnderC = (_node: SceneNode, parent: SceneNode): boolean => parent.name !== "C";
    expect(moveSceneNodes(root, ids(by.B), by.C.id, "inside", noUnderC)).toBeNull();
    expect(moveSceneNodes(root, ids(by.B), by.C1.id, "before", noUnderC)).toBeNull();
    expect(shape(moveSceneNodes(root, ids(by.B), by.A.id, "inside", noUnderC)!)).toBe("Root(A(A1 A2 B) C(C1) D)");
  });

  it("keeps every node's id and everything it holds, and does not change the original tree", () => {
    const { root, by } = tree();
    const before = shape(root);
    const moved = moveSceneNodes(root, ids(by.A, by.D), by.C1.id, "after")!;
    expect(shape(root)).toBe(before);
    const collect = (node: SceneNode): string[] => [node.id, ...node.children.flatMap(collect)];
    expect(collect(moved).sort()).toEqual(collect(root).sort());
    expect(moved.children.find((c) => c.name === "C")!.children.map((c) => c.id)).toEqual([by.C1.id, by.A.id, by.D.id]);
  });
});
