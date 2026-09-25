import type { ScreenId } from "./index";
import type { ProjectMode } from "./project-mode";
import { SCENE_NODE_KINDS_2D, type SceneNode, type SceneNodeKind } from "./scene-node";

/**
 * Which DS screen is which in a 3D project (requirements/scene-designer/STORY.choose-2d-screen-in-3d-project.md). The DS's 3D engine drives
 * one screen; the other screen has its 2D engine, so a 3D project's second screen is a 2D screen. A project keeps the choice in one place, the
 * `screen` of its scene root (a Node3D, which is drawn by the 3D engine): the root's screen is the 3D screen and the other is the 2D screen.
 * A project saved before the choice existed has its root on "top", so it reads as 3D on top and 2D on the bottom, which is how it always ran.
 */

/** Where a new 3D project puts its 2D screen: the bottom one (the touch screen, good for menus and a HUD). */
export const DEFAULT_TWO_D_SCREEN: ScreenId = "bottom";

export const otherScreen = (screen: ScreenId): ScreenId => (screen === "top" ? "bottom" : "top");

/** Node kinds the 2D engine draws (and so the ones that live on the 2D screen): every 2D kind except the sound and animation players, which aren't drawn by either engine. */
const TWO_D_VISUAL_KINDS: ReadonlySet<SceneNodeKind> = new Set(SCENE_NODE_KINDS_2D.filter((kind) => kind !== "AudioStreamPlayer" && kind !== "AnimationPlayer"));

export function isTwoDVisualKind(kind: SceneNodeKind): boolean {
  return TWO_D_VISUAL_KINDS.has(kind);
}

/** The screen the 3D engine drives in this project, or null in a 2D project (both screens are 2D there). */
export function getThreeDScreen(project: { mode: ProjectMode; scene: SceneNode }): ScreenId | null {
  return project.mode === "3D" ? project.scene.screen : null;
}

/** The screen a 3D project's 2D nodes are on, or null in a 2D project. */
export function getTwoDScreen(project: { mode: ProjectMode; scene: SceneNode }): ScreenId | null {
  const threeD = getThreeDScreen(project);
  return threeD === null ? null : otherScreen(threeD);
}

/** The screen a node of `kind` belongs on in a 3D project whose 3D screen is `threeDScreen`: 2D-drawn kinds on the other one, everything else with the 3D engine. */
export function screenForKind(kind: SceneNodeKind, threeDScreen: ScreenId): ScreenId {
  return isTwoDVisualKind(kind) ? otherScreen(threeDScreen) : threeDScreen;
}

/** The scene with every node's `screen` set for a 3D project whose 3D screen is `threeDScreen` (the root's own screen included, since it is where the choice is kept). */
export function withThreeDScreen(scene: SceneNode, threeDScreen: ScreenId): SceneNode {
  const walk = (node: SceneNode): SceneNode => {
    const screen = screenForKind(node.kind, threeDScreen);
    const children = node.children.map(walk);
    const unchanged = node.screen === screen && children.every((child, index) => child === node.children[index]);
    return unchanged ? node : { ...node, screen, children };
  };
  return walk(scene);
}
