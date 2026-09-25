import type { AnimationPlayerData } from "./animation";
import type { AudioPlayerData } from "./audio-player";
import type { CollisionShapeData } from "./collision-shape";
import { getPrimitiveTriangleCount } from "./primitive-geometry";
import type { ScreenId } from "./index";

/**
 * Node kinds available in the designer, modeled after Godot's node types.
 * The DS's 2D engine and 3D engine are separate hardware units (only one
 * screen can receive 3D output at a time), so nodes are tagged 2D or 3D
 * the same way Godot itself keeps CanvasItem and Node3D hierarchies distinct.
 */
export type SceneNodeKind2D =
  | "Node2D"
  | "Sprite2D"
  | "AnimatedSprite2D"
  | "Camera2D"
  | "TileMap"
  | "Label"
  | "CollisionShape2D"
  | "Area2D"
  | "AudioStreamPlayer"
  | "AnimationPlayer";

export type SceneNodeKind3D =
  | "Node3D"
  | "MeshInstance3D"
  | "Camera3D"
  | "DirectionalLight3D"
  | "OmniLight3D"
  | "CollisionShape3D";

export type SceneNodeKind = SceneNodeKind2D | SceneNodeKind3D;

/** All 2D node kinds, in the order they should be offered in "Add Node" pickers. */
export const SCENE_NODE_KINDS_2D: SceneNodeKind2D[] = [
  "Node2D",
  "Sprite2D",
  "AnimatedSprite2D",
  "Camera2D",
  "TileMap",
  "Label",
  "CollisionShape2D",
  "Area2D",
  "AudioStreamPlayer",
  "AnimationPlayer"
];

/** All 3D node kinds, in the order they should be offered in "Add Node" pickers. */
export const SCENE_NODE_KINDS_3D: SceneNodeKind3D[] = [
  "Node3D",
  "MeshInstance3D",
  "Camera3D",
  "DirectionalLight3D",
  "OmniLight3D",
  "CollisionShape3D"
];

export const NODE_KINDS_3D: ReadonlySet<SceneNodeKind> = new Set<SceneNodeKind>(SCENE_NODE_KINDS_3D);

export function is3DNodeKind(kind: SceneNodeKind): kind is SceneNodeKind3D {
  return NODE_KINDS_3D.has(kind);
}

/** Node kinds that occupy a hardware sprite slot (OAM entry) on their screen. */
export const OAM_CONSUMING_KINDS: ReadonlySet<SceneNodeKind> = new Set(["Sprite2D", "AnimatedSprite2D"]);

export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Basic primitive shapes offered until custom mesh import exists. Their geometry lives in `primitive-geometry.ts`. */
export const MESH_PRIMITIVES = ["cube", "sphere", "plane", "cylinder"] as const;
export type MeshPrimitive = (typeof MESH_PRIMITIVES)[number];

/**
 * What a light has beyond a transform. `intensity` is 0..1 and means the brightness of a white light: the DS has no
 * light strength, only a light color, so it is compiled as a color of `round(31 * intensity)` (31 real steps, and
 * nothing brighter than full white). See requirements/scene-designer/STORY.directional-light-intensity.md.
 */
export interface LightData {
  intensity: number;
}

/** A light's intensity, 1 when it has none (every light in a project saved before intensity existed). */
export function getLightIntensity(node: { light?: LightData }): number {
  return node.light?.intensity ?? 1;
}

export interface MeshInstance3DData {
  /** A built-in shape. Exactly one of `primitive` and `importedMeshId` is set. */
  primitive?: MeshPrimitive;
  /** The id of an imported model in the project's `meshes` (see `imported-mesh.ts`). */
  importedMeshId?: string;
  /** The id of a texture in the project's `textures` (see `imported-texture.ts`); absent for a plain mesh. */
  textureId?: string;
  /**
   * Triangles this instance contributes to the DS's per-frame 3D budget, as of when the node was
   * created or its mesh last changed. A record of the count only: the budget and the compiler always
   * recompute it from the geometry (`resolveMeshGeometry`), so a project saved before the primitives
   * were re-tessellated still reports the right cost.
   */
  triangleCount: number;
}

/**
 * A single entry in the scene tree, analogous to a Godot Node. 3D-only fields
 * (`transform3D`, `mesh`) are only meaningful when `kind` is a 3D node kind.
 */
export interface SceneNode {
  id: string;
  name: string;
  kind: SceneNodeKind;
  /** Which physical DS screen this node is rendered/active on. */
  screen: ScreenId;
  position: Vector2;
  visible: boolean;
  children: SceneNode[];
  /** Position/rotation (Euler, degrees)/scale in 3D space; present only on 3D node kinds. */
  transform3D?: {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  };
  /** Mesh primitive + triangle cost; present only on MeshInstance3D nodes. */
  mesh?: MeshInstance3DData;
  /** Light properties; only meaningful on a DirectionalLight3D. Absent means the defaults (full intensity). */
  light?: LightData;
  /** Sound and playback settings; only meaningful on an AudioStreamPlayer. Absent means the defaults (see `getAudioPlayer`). */
  audio?: AudioPlayerData;
  /** Shape and size; only meaningful on a CollisionShape3D. Absent means the defaults (see `getCollisionShape`). */
  collision?: Partial<Omit<CollisionShapeData, "size">> & { size?: Partial<Vector3> };
  /** Animations; only meaningful on an AnimationPlayer. Absent means none (see `getAnimationPlayer`). */
  animation?: Partial<AnimationPlayerData>;
  /** The id of the script (in the project's `scripts`) attached to this node, if any. */
  scriptId?: string;
}

let nodeCounter = 0;

function nextNodeId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter}`;
}

export function createSceneNode(partial: {
  name: string;
  kind: SceneNodeKind;
  screen?: ScreenId;
  position?: Vector2;
  visible?: boolean;
  children?: SceneNode[];
  transform3D?: Partial<{ position: Vector3; rotation: Vector3; scale: Vector3 }>;
  mesh?: MeshPrimitive;
}): SceneNode {
  const node: SceneNode = {
    id: nextNodeId(partial.kind.toLowerCase()),
    name: partial.name,
    kind: partial.kind,
    screen: partial.screen ?? "top",
    position: partial.position ?? { x: 0, y: 0 },
    visible: partial.visible ?? true,
    children: partial.children ?? []
  };

  if (is3DNodeKind(partial.kind)) {
    node.transform3D = {
      position: partial.transform3D?.position ?? { x: 0, y: 0, z: 0 },
      rotation: partial.transform3D?.rotation ?? { x: 0, y: 0, z: 0 },
      scale: partial.transform3D?.scale ?? { x: 1, y: 1, z: 1 }
    };
  }

  if (partial.kind === "MeshInstance3D") {
    const primitive = partial.mesh ?? "cube";
    node.mesh = { primitive, triangleCount: getPrimitiveTriangleCount(primitive) };
  }

  return node;
}

/**
 * A starter scene tree used to populate a brand-new project, so the editor
 * never opens on a completely empty node tree.
 */
export function createSampleSceneTree(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node2D",
    screen: "top",
    children: [
      createSceneNode({ name: "Camera", kind: "Camera2D", screen: "top", position: { x: 128, y: 96 } }),
      createSceneNode({ name: "Player", kind: "Sprite2D", screen: "top", position: { x: 96, y: 120 } }),
      createSceneNode({ name: "Enemy", kind: "Sprite2D", screen: "top", position: { x: 180, y: 80 } }),
      createSceneNode({ name: "Level", kind: "TileMap", screen: "top", position: { x: 0, y: 0 } }),
      createSceneNode({
        name: "HUD",
        kind: "Node2D",
        screen: "bottom",
        children: [
          createSceneNode({ name: "ScoreLabel", kind: "Label", screen: "bottom", position: { x: 8, y: 8 } }),
          createSceneNode({ name: "TouchArea", kind: "Area2D", screen: "bottom", position: { x: 128, y: 96 } })
        ]
      }),
      createSceneNode({ name: "BGM", kind: "AudioStreamPlayer", screen: "top", position: { x: 0, y: 0 } }),
      createSceneNode({
        name: "World3D",
        kind: "Node3D",
        screen: "top",
        children: [
          createSceneNode({
            name: "Camera3D",
            kind: "Camera3D",
            screen: "top",
            transform3D: { position: { x: 0, y: 2, z: 6 }, rotation: { x: -10, y: 0, z: 0 } }
          }),
          createSceneNode({
            name: "Sun",
            kind: "DirectionalLight3D",
            screen: "top",
            transform3D: { rotation: { x: -45, y: 30, z: 0 } }
          }),
          createSceneNode({
            name: "Ground",
            kind: "MeshInstance3D",
            screen: "top",
            mesh: "plane",
            transform3D: { position: { x: 0, y: -1, z: 0 }, scale: { x: 8, y: 1, z: 8 } }
          }),
          createSceneNode({
            name: "PlayerModel",
            kind: "MeshInstance3D",
            screen: "top",
            mesh: "cube",
            transform3D: { position: { x: 0, y: 0, z: 0 } }
          })
        ]
      })
    ]
  });
}

/** Flattens a scene tree into a list, useful for lookups and budget math. */
export function flattenSceneTree(root: SceneNode): SceneNode[] {
  const result: SceneNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    stack.push(...node.children);
  }
  return result;
}

export function findSceneNode(root: SceneNode, id: string): SceneNode | undefined {
  return flattenSceneTree(root).find((node) => node.id === id);
}

/** Returns a new tree with the node matching `id` replaced by `updater(node)`. */
export function updateSceneNode(root: SceneNode, id: string, updater: (node: SceneNode) => SceneNode): SceneNode {
  if (root.id === id) {
    return updater(root);
  }
  return { ...root, children: root.children.map((child) => updateSceneNode(child, id, updater)) };
}

/**
 * Removes the node matching `id` (and its subtree) from wherever it lives in
 * the tree. A no-op if `id` is the tree's own root, since a scene always
 * needs a root node.
 */
export function removeSceneNode(root: SceneNode, id: string): SceneNode {
  return {
    ...root,
    children: root.children.filter((child) => child.id !== id).map((child) => removeSceneNode(child, id))
  };
}

/** Deep-clones a node subtree, assigning fresh ids throughout so it can coexist with the original. */
export function duplicateSceneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    id: nextNodeId(node.kind.toLowerCase()),
    position: { ...node.position },
    transform3D: node.transform3D
      ? {
          position: { ...node.transform3D.position },
          rotation: { ...node.transform3D.rotation },
          scale: { ...node.transform3D.scale }
        }
      : undefined,
    mesh: node.mesh ? { ...node.mesh } : undefined,
    children: node.children.map(duplicateSceneNode)
  };
}

/** Inserts `newNode` as a new sibling immediately after `siblingId`, wherever that sibling lives in the tree. */
export function insertNodeAfterSibling(root: SceneNode, siblingId: string, newNode: SceneNode): SceneNode {
  const index = root.children.findIndex((child) => child.id === siblingId);
  if (index !== -1) {
    const children = [...root.children];
    children.splice(index + 1, 0, newNode);
    return { ...root, children };
  }
  return { ...root, children: root.children.map((child) => insertNodeAfterSibling(child, siblingId, newNode)) };
}

/** Appends a numeric suffix to `baseName` until it no longer collides with `existingNames`. */
export function uniqueNodeName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;
  let suffix = 2;
  while (existingNames.includes(`${baseName}${suffix}`)) suffix += 1;
  return `${baseName}${suffix}`;
}
