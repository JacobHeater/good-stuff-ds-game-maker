import { describe, expect, it } from "vitest";

import { copyName, flattenSceneTree, createSceneNode } from "./scene-node";
import { getNodeKindsForMode } from "./project-mode";
import { isTwoDVisualKind } from "./screen-layout";
import { DEFAULT_TOUCH_AREA_2D, getTouchArea2D, getTouchArea2DRect, getTouchArea3D, normalizeTouchArea2D } from "./touch-area";

describe("touch areas", () => {
  it("a TouchArea2D with no settings is 64 x 64, and its rectangle is centered on its position like a sprite", () => {
    const node = createSceneNode({ name: "B", kind: "TouchArea2D", position: { x: 100, y: 50 } });
    expect(getTouchArea2D(node)).toEqual(DEFAULT_TOUCH_AREA_2D);
    expect(getTouchArea2DRect(node)).toEqual({ x: 68, y: 18, width: 64, height: 64 });
    expect(getTouchArea2DRect({ position: { x: 10, y: 10 }, touchArea2D: { width: 21, height: 8 } })).toEqual({ x: 0, y: 6, width: 21, height: 8 });
  });

  it("keeps a rectangle in whole pixels between 1 and the size of the screen", () => {
    expect(normalizeTouchArea2D({ width: 0, height: 1000 })).toEqual({ width: 1, height: 192 });
    expect(normalizeTouchArea2D({ width: 300.4, height: 10.6 })).toEqual({ width: 256, height: 11 });
    expect(getTouchArea2D({ touchArea2D: { width: 32 } })).toEqual({ width: 32, height: 64 }); // a missing field is its default
  });

  it("a TouchArea3D defaults to a unit box, fills in missing fields and clamps sizes", () => {
    expect(getTouchArea3D({})).toEqual({ shape: "box", size: { x: 1, y: 1, z: 1 }, radius: 0.5 });
    expect(getTouchArea3D({ touchArea3D: { shape: "sphere", radius: 5000, size: { y: 2 } } })).toEqual({ shape: "sphere", size: { x: 1, y: 2, z: 1 }, radius: 1000 });
    expect(getTouchArea3D({ touchArea3D: { radius: 0 } }).radius).toBe(0.01);
  });

  it("is offered where it can be used: 2D kind in every project, 3D kind only in 3D projects", () => {
    expect(getNodeKindsForMode("2D")).toContain("TouchArea2D");
    expect(getNodeKindsForMode("2D")).not.toContain("TouchArea3D");
    expect(getNodeKindsForMode("3D")).toEqual(expect.arrayContaining(["TouchArea2D", "TouchArea3D"]));
  });

  it("a TouchArea2D lives on the 2D screen (a 3D project's 2D screen), a TouchArea3D is drawn by the 3D engine", () => {
    expect(isTwoDVisualKind("TouchArea2D")).toBe(true);
    expect(isTwoDVisualKind("TouchArea3D")).toBe(false);
    expect(createSceneNode({ name: "P", kind: "TouchArea3D" }).transform3D).toBeDefined();
    expect(createSceneNode({ name: "B", kind: "TouchArea2D" }).transform3D).toBeUndefined();
  });

  it("duplicating keeps the settings", () => {
    const node = { ...createSceneNode({ name: "B", kind: "TouchArea2D" }), touchArea2D: { width: 10, height: 20 } };
    const copy = flattenSceneTree({ ...createSceneNode({ name: "Root", kind: "Node2D" }), children: [node] });
    expect(copy.find((n) => n.name === "B")?.touchArea2D).toEqual({ width: 10, height: 20 });
  });
});

describe("names for copies", () => {
  it("counts up from 2, skipping names the siblings already have", () => {
    expect(copyName("JengaBlock", ["JengaBlock"])).toBe("JengaBlock2");
    expect(copyName("JengaBlock", ["JengaBlock", "JengaBlock2"])).toBe("JengaBlock3");
    expect(copyName("JengaBlock", ["JengaBlock", "JengaBlock3"])).toBe("JengaBlock2");
  });
  it("counts on from a number the name already ends in, never making JengaBlock22", () => {
    expect(copyName("JengaBlock2", ["JengaBlock", "JengaBlock2"])).toBe("JengaBlock3");
    expect(copyName("Level3", ["Level3"])).toBe("Level4");
    expect(copyName("Wall1", ["Wall1", "Wall2"])).toBe("Wall3");
    expect(copyName("7", ["7"])).toBe("72"); // a name that is only digits has no base to count from
  });
});
