import { createSceneNode, SCENE_NODE_KINDS_2D, SCENE_NODE_KINDS_3D, type SceneNode, type SceneNodeKind } from "./scene-node";

/**
 * A project's rendering pipeline, chosen once at creation and permanent
 * for the life of the project — see
 * requirements/startup-view/STORY.new-project-flow-with-mode-commitment.md.
 */
export type ProjectMode = "2D" | "3D";

export const PROJECT_MODES: readonly ProjectMode[] = ["2D", "3D"];

/**
 * Node kinds a project of `mode` may contain. `AudioStreamPlayer` is
 * engine-independent (it isn't drawn by either the 2D or 3D pipeline), so
 * it's offered in both modes even though it's declared with the 2D kinds.
 */
export function getNodeKindsForMode(mode: ProjectMode): SceneNodeKind[] {
  return mode === "2D" ? [...SCENE_NODE_KINDS_2D] : [...SCENE_NODE_KINDS_3D, "AudioStreamPlayer"];
}

export function isNodeKindAllowedInMode(kind: SceneNodeKind, mode: ProjectMode): boolean {
  return getNodeKindsForMode(mode).includes(kind);
}

/** An empty scene whose root belongs to `mode`'s pipeline. Used by New Project. */
export function createBlankSceneTree(mode: ProjectMode): SceneNode {
  return createSceneNode({ name: "Main", kind: mode === "2D" ? "Node2D" : "Node3D" });
}
