import { describe, expect, it } from "vitest";

import { createBlankSceneTree, getNodeKindsForMode } from "./project-mode";
import { createSceneNode } from "./scene-node";
import { DEFAULT_TWO_D_SCREEN, getThreeDScreen, getTwoDScreen, isTwoDVisualKind, otherScreen, screenForKind, withThreeDScreen } from "./screen-layout";

/** requirements/scene-designer/STORY.choose-2d-screen-in-3d-project.md */

describe("which screen is which in a 3D project", () => {
  it("puts the 2D screen at the bottom by default, so 3D is on top", () => {
    expect(DEFAULT_TWO_D_SCREEN).toBe("bottom");
    const scene = createBlankSceneTree("3D");
    expect(scene.screen).toBe("top");
    expect(getThreeDScreen({ mode: "3D", scene })).toBe("top");
    expect(getTwoDScreen({ mode: "3D", scene })).toBe("bottom");
  });

  it("puts 3D on the other screen when the 2D screen is the top one", () => {
    const scene = createBlankSceneTree("3D", "top");
    expect(scene.screen).toBe("bottom");
    expect(getThreeDScreen({ mode: "3D", scene })).toBe("bottom");
    expect(getTwoDScreen({ mode: "3D", scene })).toBe("top");
  });

  it("has no such choice in a 2D project (both screens are 2D)", () => {
    const scene = createBlankSceneTree("2D", "bottom");
    expect(getThreeDScreen({ mode: "2D", scene })).toBeNull();
    expect(getTwoDScreen({ mode: "2D", scene })).toBeNull();
  });

  it("reads a project saved before the choice existed (root on top) as 3D on top", () => {
    const scene = createSceneNode({ name: "Main", kind: "Node3D" }); // screen defaults to "top", as in every old file
    expect(getTwoDScreen({ mode: "3D", scene })).toBe("bottom");
  });

  it("puts what the 2D engine draws on the 2D screen and everything else with the 3D engine", () => {
    for (const kind of ["Sprite2D", "AnimatedSprite2D", "Camera2D", "TileMap", "Label", "CollisionShape2D", "Area2D", "Node2D"] as const) {
      expect(isTwoDVisualKind(kind)).toBe(true);
      expect(screenForKind(kind, "top")).toBe("bottom");
      expect(screenForKind(kind, "bottom")).toBe("top");
    }
    for (const kind of ["Node3D", "MeshInstance3D", "Camera3D", "DirectionalLight3D", "OmniLight3D", "CollisionShape3D", "AudioStreamPlayer", "AnimationPlayer"] as const) {
      expect(isTwoDVisualKind(kind)).toBe(false);
      expect(screenForKind(kind, "top")).toBe("top");
      expect(screenForKind(kind, "bottom")).toBe("bottom");
    }
  });

  it("swapping moves every node, and leaves nodes that are already right as the same objects", () => {
    const label = createSceneNode({ name: "Score", kind: "Label", screen: "bottom" });
    const cube = createSceneNode({ name: "Cube", kind: "MeshInstance3D", screen: "top" });
    const group = createSceneNode({ name: "Hud", kind: "Node2D", screen: "bottom", children: [label] });
    const root = createSceneNode({ name: "Main", kind: "Node3D", screen: "top", children: [cube, group] });
    expect(withThreeDScreen(root, "top")).toBe(root);
    const swapped = withThreeDScreen(root, "bottom");
    expect(swapped.screen).toBe("bottom");
    expect(swapped.children[0].screen).toBe("bottom");
    expect(swapped.children[1].screen).toBe("top");
    expect(swapped.children[1].children[0].screen).toBe("top");
    expect(root.screen).toBe("top"); // the original is not changed
    expect(withThreeDScreen(swapped, "top").screen).toBe("top");
  });

  it("offers 2D node kinds in a 3D project too, without listing the sound and animation players twice", () => {
    const kinds = getNodeKindsForMode("3D");
    expect(kinds).toEqual(expect.arrayContaining(["MeshInstance3D", "Sprite2D", "Label", "Area2D", "Node2D", "AudioStreamPlayer", "AnimationPlayer"]));
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(getNodeKindsForMode("2D")).not.toContain("MeshInstance3D");
  });

  it("names the other screen", () => {
    expect(otherScreen("top")).toBe("bottom");
    expect(otherScreen("bottom")).toBe("top");
  });
});
