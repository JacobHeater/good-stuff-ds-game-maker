import type { Vector2 } from "./scene-node";

/**
 * A CollisionShape2D (requirements/collision/EPIC.collision-shapes.md -> scene-designer/EPIC.full-2d-games.md): a rectangle or
 * circle a script can ask about with `overlaps()` (the same call 3D's CollisionShape3D already has), centered on the node's
 * `position` (as a sprite's picture is). Every field is optional in a saved file; a node without `collision2D`, or without one
 * of its fields, has the defaults below.
 *
 * v1 is overlap detection only, like a 3D CollisionShape3D before `move_and_collide`/solid shapes existed -- no "solid" flag,
 * no body movement, no floor/wall/ceiling. That is deliberately out of scope here (EPIC.full-2d-games.md): it is real 2D
 * physics work of its own, not a small extension of overlap checking.
 */
export type CollisionShape2DKind = "rect" | "circle";
export const COLLISION_SHAPE_2D_KINDS: readonly CollisionShape2DKind[] = ["rect", "circle"];

export interface CollisionShape2DData {
  shape: CollisionShape2DKind;
  /** A rect's full width and height, in pixels. */
  size: Vector2;
  /** A circle's radius, in pixels. */
  radius: number;
}

export const COLLISION_SHAPE_2D_SIZE_MIN = 1;
export const COLLISION_SHAPE_2D_SIZE_MAX = 512;

export const DEFAULT_COLLISION_SHAPE_2D: Readonly<CollisionShape2DData> = { shape: "rect", size: { x: 32, y: 32 }, radius: 16 };

function clampSize(value: number): number {
  return Math.min(COLLISION_SHAPE_2D_SIZE_MAX, Math.max(COLLISION_SHAPE_2D_SIZE_MIN, Math.round(value)));
}

/** A shape's data with sizes in range (whole pixels). */
export function normalizeCollisionShape2D(data: CollisionShape2DData): CollisionShape2DData {
  return {
    shape: data.shape,
    size: { x: clampSize(data.size.x), y: clampSize(data.size.y) },
    radius: clampSize(data.radius)
  };
}

/** A node's 2D collision shape with the defaults filled in and the sizes normalized. */
export function getCollisionShape2D(node: { collision2D?: Partial<Omit<CollisionShape2DData, "size">> & { size?: Partial<Vector2> } }): CollisionShape2DData {
  const data = node.collision2D ?? {};
  return normalizeCollisionShape2D({
    shape: data.shape ?? DEFAULT_COLLISION_SHAPE_2D.shape,
    size: { x: data.size?.x ?? DEFAULT_COLLISION_SHAPE_2D.size.x, y: data.size?.y ?? DEFAULT_COLLISION_SHAPE_2D.size.y },
    radius: data.radius ?? DEFAULT_COLLISION_SHAPE_2D.radius
  });
}
