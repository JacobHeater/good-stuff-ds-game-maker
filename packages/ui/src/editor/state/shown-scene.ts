import { expandSceneInstances, withSceneTree, type SceneNode } from "@goodstuff/core";
import { useMemo } from "react";

import { useEditorStore } from "./editor-store";

/**
 * The scene as the viewports draw it: the scene being edited with every instance of another scene replaced by that scene's nodes (requirements/scene-designer/STORY.scene-instances.md).
 * The nodes inside an instance have ids like `<instance id>/<node id>`; selecting one selects the instance.
 */
export function useShownSceneRoot(): SceneNode {
  const { state } = useEditorStore();
  const { project, activeSceneId, sceneRoot } = state;
  return useMemo(() => (project ? expandSceneInstances(withSceneTree(project, activeSceneId, sceneRoot), sceneRoot) : sceneRoot), [project, activeSceneId, sceneRoot]);
}
