import type { ScreenId } from "./index";
import { createSceneNode, SCENE_NODE_KINDS_2D, SCENE_NODE_KINDS_3D, type SceneNode, type SceneNodeKind } from "./scene-node";
import { DEFAULT_TWO_D_SCREEN, otherScreen } from "./screen-layout";

/**
 * A project's rendering pipeline, chosen once at creation and permanent
 * for the life of the project — see
 * requirements/startup-view/STORY.new-project-flow-with-mode-commitment.md.
 */
export type ProjectMode = "2D" | "3D";

export const PROJECT_MODES: readonly ProjectMode[] = ["2D", "3D"];

/**
 * Node kinds a project of `mode` may contain. `AudioStreamPlayer` and `AnimationPlayer` are
 * engine-independent (they aren't drawn by either the 2D or 3D pipeline), so
 * they're offered in both modes even though they're declared with the 2D kinds.
 * A 3D project also offers the 2D kinds: the DS's other screen is a 2D screen
 * (see `screen-layout.ts`).
 */
export function getNodeKindsForMode(mode: ProjectMode): SceneNodeKind[] {
  return mode === "2D" ? [...SCENE_NODE_KINDS_2D] : [...SCENE_NODE_KINDS_3D, "AudioStreamPlayer", "AnimationPlayer", ...SCENE_NODE_KINDS_2D.filter((kind) => kind !== "AudioStreamPlayer" && kind !== "AnimationPlayer")];
}

export function isNodeKindAllowedInMode(kind: SceneNodeKind, mode: ProjectMode): boolean {
  return getNodeKindsForMode(mode).includes(kind);
}

/**
 * An empty scene whose root belongs to `mode`'s pipeline. Used by New Project. In a 3D project `twoDScreen` is the screen
 * that will hold 2D nodes; the 3D engine drives the other one (the root's own screen records it).
 */
export function createBlankSceneTree(mode: ProjectMode, twoDScreen: ScreenId = DEFAULT_TWO_D_SCREEN): SceneNode {
  return createSceneNode({ name: "Main", kind: mode === "2D" ? "Node2D" : "Node3D", screen: mode === "2D" ? "top" : otherScreen(twoDScreen) });
}
