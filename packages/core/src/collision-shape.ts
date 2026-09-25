import type { Vector3 } from "./scene-node";

/**
 * What a CollisionShape3D has beyond being a node (requirements/collision/TASK.collision-shape-model-and-persistence.md). Every field is
 * optional in a saved file: a node without `collision`, or without one of its fields, has the defaults below. The sizes follow Godot's:
 * a box's `size` is its full width, height and depth, and a capsule's or cylinder's `height` is its full height along the node's own Y axis
 * (for a capsule, including its round ends).
 */
export type CollisionShapeKind = "box" | "sphere" | "capsule" | "cylinder";

export interface CollisionShapeData {
  shape: CollisionShapeKind;
  /** A box's full extents. */
  size: Vector3;
  /** A sphere's, capsule's or cylinder's radius. */
  radius: number;
  /** A capsule's (with its round ends) or cylinder's height. */
  height: number;
  /** Bodies moved with `move_and_collide` are stopped by this shape (requirements/collision/STORY.solid-shapes-and-move-and-collide.md). */
  solid: boolean;
}

export const COLLISION_SHAPE_KINDS: readonly CollisionShapeKind[] = ["box", "sphere", "capsule", "cylinder"];
export const COLLISION_SIZE_MIN = 0.01;
export const COLLISION_SIZE_MAX = 1000;

export const DEFAULT_COLLISION_SHAPE: Readonly<CollisionShapeData> = {
  shape: "box",
  size: { x: 1, y: 1, z: 1 },
  radius: 0.5,
  height: 2,
  solid: false
};

export function clampCollisionSize(value: number): number {
  return Math.min(COLLISION_SIZE_MAX, Math.max(COLLISION_SIZE_MIN, value));
}

/** A shape's data with sizes in range and a capsule at least as tall as it is wide (its height is raised to twice its radius if not). */
export function normalizeCollisionShape(data: CollisionShapeData): CollisionShapeData {
  const radius = clampCollisionSize(data.radius);
  let height = clampCollisionSize(data.height);
  if (data.shape === "capsule" && height < radius * 2) height = clampCollisionSize(radius * 2);
  return {
    shape: data.shape,
    size: { x: clampCollisionSize(data.size.x), y: clampCollisionSize(data.size.y), z: clampCollisionSize(data.size.z) },
    radius,
    height,
    solid: data.solid
  };
}

/** A node's collision shape with the defaults filled in and the sizes normalized. */
export function getCollisionShape(node: { collision?: Partial<Omit<CollisionShapeData, "size">> & { size?: Partial<Vector3> } }): CollisionShapeData {
  const data = node.collision ?? {};
  return normalizeCollisionShape({
    shape: data.shape ?? DEFAULT_COLLISION_SHAPE.shape,
    size: {
      x: data.size?.x ?? DEFAULT_COLLISION_SHAPE.size.x,
      y: data.size?.y ?? DEFAULT_COLLISION_SHAPE.size.y,
      z: data.size?.z ?? DEFAULT_COLLISION_SHAPE.size.z
    },
    radius: data.radius ?? DEFAULT_COLLISION_SHAPE.radius,
    height: data.height ?? DEFAULT_COLLISION_SHAPE.height,
    solid: data.solid ?? DEFAULT_COLLISION_SHAPE.solid
  });
}
