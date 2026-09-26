import type { ProjectScene, ProjectSnapshot } from "./project-snapshot";
import { flattenSceneTree, type SceneNode } from "./scene-node";

/**
 * A project can hold several scenes (requirements/scene-designer/STORY.multiple-scenes.md). To keep every existing project file and every piece of code that reads `project.scene` working,
 * `project.scene` is the **starting scene's** tree, and the other scenes are `project.scenes` (each with an id and a name). The starting scene's own id and name are `sceneId` and
 * `sceneName`, absent while they are the defaults (a project with one scene looks exactly as it always did). The scenes share the project's mode, models, textures, sounds, images
 * and scripts.
 */

/** The id of a project's starting scene when the file doesn't say. */
export const DEFAULT_START_SCENE_ID = "scene-start";

/** One scene of a project, with whether it is the one the game starts in. */
export interface SceneEntry extends ProjectScene {
  isStart: boolean;
}

export function getStartSceneId(project: Pick<ProjectSnapshot, "sceneId">): string {
  return project.sceneId ?? DEFAULT_START_SCENE_ID;
}

/** The starting scene's name: what a script calls it (`change_scene("Main")`). Defaults to the name of the scene's root node. */
export function getStartSceneName(project: Pick<ProjectSnapshot, "sceneName" | "scene">): string {
  return project.sceneName ?? project.scene.name;
}

/** Every scene of the project, the starting one first, then the others in the order they are listed. */
export function listScenes(project: Pick<ProjectSnapshot, "scene" | "sceneId" | "sceneName" | "scenes">): SceneEntry[] {
  return [
    { id: getStartSceneId(project), name: getStartSceneName(project), scene: project.scene, isStart: true },
    ...(project.scenes ?? []).map((entry) => ({ ...entry, isStart: false }))
  ];
}

export function findSceneEntry(project: Pick<ProjectSnapshot, "scene" | "sceneId" | "sceneName" | "scenes">, id: string): SceneEntry | undefined {
  return listScenes(project).find((entry) => entry.id === id);
}

/** The scene trees of every scene (for what looks at every node of a project: which assets are used, which scripts are attached). */
export function allSceneTrees(project: Pick<ProjectSnapshot, "scene" | "scenes">): SceneNode[] {
  return [project.scene, ...(project.scenes ?? []).map((entry) => entry.scene)];
}

/** Every node of every scene. */
export function flattenAllScenes(project: Pick<ProjectSnapshot, "scene" | "scenes">): SceneNode[] {
  return allSceneTrees(project).flatMap((tree) => flattenSceneTree(tree));
}

/** The names of all the scenes, the starting one first. */
export function sceneNamesOf(project: Pick<ProjectSnapshot, "scene" | "sceneId" | "sceneName" | "scenes">): string[] {
  return listScenes(project).map((entry) => entry.name);
}

/**
 * The project rebuilt from a list of scenes (exactly one of them the start). A project with a single scene, named as its root node and with the default id, carries none of the
 * multi-scene fields, so it is byte-for-byte what it was before scenes existed.
 */
export function withSceneEntries<T extends ProjectSnapshot>(project: T, entries: readonly SceneEntry[]): T {
  const start = entries.find((entry) => entry.isStart);
  if (!start) throw new Error("A project needs a starting scene.");
  const { sceneId: _id, sceneName: _name, scenes: _others, ...rest } = project;
  const others = entries.filter((entry) => !entry.isStart).map(({ id, name, scene }) => ({ id, name, scene }));
  const next = { ...rest, scene: start.scene } as T;
  if (start.id !== DEFAULT_START_SCENE_ID) next.sceneId = start.id;
  if (start.name !== start.scene.name) next.sceneName = start.name;
  if (others.length > 0) {
    // With other scenes the start scene's name is always written, so the file says what it is called.
    next.sceneName = start.name;
    next.sceneId = start.id;
    next.scenes = others;
  }
  return next;
}

/** The project with one scene's tree replaced (by scene id); the same project when there is no such scene. */
export function withSceneTree<T extends ProjectSnapshot>(project: T, id: string, tree: SceneNode): T {
  const entries = listScenes(project);
  if (!entries.some((entry) => entry.id === id)) return project;
  return withSceneEntries(
    project,
    entries.map((entry) => (entry.id === id ? { ...entry, scene: tree } : entry))
  );
}

/** A name for a scene that no other scene has: `base`, then `base2`, `base3`, ... (a base ending in a number counts on from it). */
export function uniqueSceneName(existing: readonly string[], base: string): string {
  const taken = new Set(existing);
  const clean = base.trim() === "" ? "Scene" : base.trim();
  if (!taken.has(clean)) return clean;
  const match = /^(.*?)(\d+)$/.exec(clean);
  const stem = match ? match[1] : clean;
  for (let n = match ? Number(match[2]) + 1 : 2; ; n++) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
}

/** A fresh id for a new scene. */
export function newSceneId(): string {
  return `scene-${crypto.randomUUID()}`;
}

// ---- Scene instances (requirements/scene-designer/STORY.scene-instances.md) ----------------------------------------------------------------------------------------------------

type SceneList = Pick<ProjectSnapshot, "scene" | "sceneId" | "sceneName" | "scenes">;

/** The tree with every scene id in `ids` mapped (a node inside an instance is called `<instance id>/<its own id>`), and the animation tracks that target them following. */
function renamedSubtree(node: SceneNode, rename: (id: string) => string): SceneNode {
  return {
    ...node,
    id: rename(node.id),
    ...(node.animation
      ? {
          animation: {
            ...node.animation,
            animations: (node.animation.animations ?? []).map((animation) => ({ ...animation, tracks: animation.tracks.map((track) => ({ ...track, nodeId: rename(track.nodeId) })) }))
          }
        }
      : {}),
    children: node.children.map((child) => renamedSubtree(child, rename))
  };
}

function shiftedSubtree(node: SceneNode, dx: number, dy: number): SceneNode {
  return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, children: node.children.map((child) => shiftedSubtree(child, dx, dy)) };
}

/**
 * The scene tree with every instance node replaced by the tree of the scene it is an instance of, all the way down (an instance inside an instance). The instance's own name, place
 * (position or transform), screen, visibility and script win over those of the scene's root; everything under it is the scene's. The nodes inside are given ids of the form
 * `<instance id>/<node id>` so two instances of one scene don't share ids, and animation tracks follow them. An instance of a scene that isn't there, or that (through others) contains itself,
 * becomes an empty node. The tree is returned as it is when it has no instances.
 */
export function expandSceneInstances(project: SceneList, root: SceneNode, chain: readonly string[] = []): SceneNode {
  const visit = (node: SceneNode, path: readonly string[]): SceneNode => {
    if (node.instanceOf === undefined) {
      const children = node.children.map((child) => visit(child, path));
      return children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
    }
    const source = findSceneEntry(project, node.instanceOf);
    if (!source || path.includes(source.id)) return { ...node, children: [] };
    const inner = visit(source.scene, [...path, source.id]);
    const renamed = renamedSubtree(inner, (id) => (id === inner.id ? node.id : `${node.id}/${id}`));
    // 2D positions are in screen pixels and a parent's is never added to its children's, so the instance's place is added to every 2D node inside it (the scene is drawn as authored when the
    // instance is where the scene's own root is).
    const dx = node.position.x - inner.position.x;
    const dy = node.position.y - inner.position.y;
    const shifted = dx === 0 && dy === 0 ? renamed.children : renamed.children.map((child) => shiftedSubtree(child, dx, dy));
    const { instanceOf: _marker, ...rest } = renamed;
    return {
      ...rest,
      children: shifted,
      name: node.name,
      screen: node.screen,
      position: node.position,
      visible: node.visible,
      ...(node.transform3D ? { transform3D: node.transform3D } : {}),
      ...(node.transform2D ? { transform2D: node.transform2D } : {}),
      ...(node.scriptId !== undefined ? { scriptId: node.scriptId } : {}),
      instanceOf: node.instanceOf
    };
  };
  return visit(root, chain);
}

/** The id of the instance node an expanded node belongs to (`a/b/c` -> `a`), or the id itself when it is a plain node: what selecting something inside an instance selects. */
export function outerNodeId(id: string): string {
  const slash = id.indexOf("/");
  return slash < 0 ? id : id.slice(0, slash);
}

/** Whether putting an instance of `sourceId` into the scene `targetId` would make a scene contain itself (they are the same, or the source already contains the target). */
export function instanceWouldCycle(project: SceneList, targetId: string, sourceId: string): boolean {
  const contains = (sceneId: string, wanted: string, seen: Set<string>): boolean => {
    if (sceneId === wanted) return true;
    if (seen.has(sceneId)) return false;
    seen.add(sceneId);
    const entry = findSceneEntry(project, sceneId);
    if (!entry) return false;
    return flattenSceneTree(entry.scene).some((node) => node.instanceOf !== undefined && contains(node.instanceOf, wanted, seen));
  };
  return contains(sourceId, targetId, new Set());
}

/** The instance nodes in a scene that name a scene the project doesn't have. */
export function danglingInstances(project: SceneList, root: SceneNode): SceneNode[] {
  return flattenSceneTree(root).filter((node) => node.instanceOf !== undefined && !findSceneEntry(project, node.instanceOf));
}
