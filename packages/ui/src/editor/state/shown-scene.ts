import { expandSceneInstances, expandSpawnPools, withSceneTree, type SceneNode } from "@goodstuff/core";
import { useMemo } from "react";

import { useEditorStore } from "./editor-store";

/**
 * The scene as the viewports draw it: the scene being edited with every spawn pool (STORY.spawn-pools.md) turned
 * into its own N instance nodes first, then every instance of another scene -- pool or plain -- replaced by that
 * scene's nodes (requirements/scene-designer/STORY.scene-instances.md). The nodes inside an instance have ids like
 * `<instance id>/<node id>`; selecting one selects the instance. This is also what the Hardware budget panel reads
 * (via `computeSceneBudget`) -- it was once fixed to read this same expanded tree instead of the raw authored one
 * for ordinary instances (BUG.triangle-budget-ignores-scene-instances.md); spawn pools need the identical fix, or
 * the live gauge would under-report a pool's own content the exact same way.
 */
export function useShownSceneRoot(): SceneNode {
  const { state } = useEditorStore();
  const { project, activeSceneId, sceneRoot } = state;
  return useMemo(() => {
    if (!project) return sceneRoot;
    const withTree = withSceneTree(project, activeSceneId, sceneRoot);
    return expandSceneInstances(withTree, expandSpawnPools(withTree, sceneRoot).tree);
  }, [project, activeSceneId, sceneRoot]);
}
