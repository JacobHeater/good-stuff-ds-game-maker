import { createSceneNode, danglingInstances, expandSceneInstances, flattenSceneTree, listScenes, sceneNamesOf, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import type { DsScene3D } from "./ds-scene";
import { translateScene3D, type TranslateOptions } from "./translate-scene-3d";

export interface TranslateProjectResult {
  /** Every scene of the project, the starting scene first; null exactly when `diagnostics` contains an error. */
  scenes: DsScene3D[] | null;
  diagnostics: Diagnostic[];
}

/**
 * Translates every scene of a 3D project (requirements/scene-designer/STORY.multiple-scenes.md). Each scene is translated on its own, as a project whose starting scene it is: it
 * counts its own textures, sounds, images and nodes against the DS's limits (the ROM only holds one scene's assets at a time), and its scripts are written with names of their own.
 * The scenes share the project's models, textures, sounds, images and scripts. In a project with several scenes every diagnostic names its scene.
 */
export function translateProject3D(project: ProjectSnapshot, options: TranslateOptions = {}): TranslateProjectResult {
  const entries = listScenes(project);
  const sceneNames = sceneNamesOf(project);
  const diagnostics: Diagnostic[] = [];
  const scenes: DsScene3D[] = [];
  entries.forEach((entry, index) => {
    const { scenes: _others, sceneId: _id, sceneName: _name, ...single } = project;
    // An instance of a scene is replaced by that scene's nodes before anything else looks at the tree.
    const missing: Diagnostic[] = danglingInstances(project, entry.scene).map((node) => ({
      severity: "warning" as const,
      code: "scene-instance-missing" as const,
      nodeName: node.name,
      message: "This node is an instance of a scene that isn't in the project any more, so nothing is drawn or run for it."
    }));
    const expanded = expandSceneInstances(project, entry.scene);
    // A scene made to be put inside other scenes (an enemy, a coin) has no camera of its own. It still has to be a scene the game could switch to, so it gets a default one; the starting scene
    // is the game's first picture and must have its own.
    const scene: SceneNode = index > 0 && !flattenSceneTree(expanded).some((node) => node.kind === "Camera3D") ? withDefaultCamera(expanded) : expanded;
    const result = translateScene3D({ ...single, scene }, { ...options, sceneIndex: index, sceneNames });
    const all = [...missing, ...result.diagnostics];
    diagnostics.push(...(entries.length > 1 ? all.map((d) => ({ ...d, sceneName: entry.name })) : all));
    if (result.scene) scenes.push(result.scene);
  });
  if (hasErrors(diagnostics) || scenes.length !== entries.length) return { scenes: null, diagnostics };
  return { scenes, diagnostics };
}

/** The scene with a camera looking at the middle of the world from a little back and up, for a scene that has none. */
function withDefaultCamera(scene: SceneNode): SceneNode {
  const camera = createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 5 } } });
  return { ...scene, children: [...scene.children, { ...camera, id: `${scene.id}/default-camera` }] };
}
