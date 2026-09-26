import type { Vector2 } from "./scene-node";

/**
 * A Sprite2D's rotation and scale (requirements/scene-designer/STORY.script-and-rotate-2d-nodes.md). Its position is the node's own `position`; the picture is
 * centered on it, and it rotates and scales about that center. `rotation` is in degrees, **clockwise** on the screen (as in Godot's 2D, where y points down), and
 * `scale` is a factor on each axis (1 is the picture's own size, a negative value flips it). Both are optional in a saved file: a node without them, or without one
 * of the fields, is upright and unscaled. The DS does this with its hardware rotation (an affine matrix per sprite, 32 to a screen).
 */
export interface SpriteTransformData {
  rotation: number;
  scale: Vector2;
}

/** The biggest a sprite's scale can be on either axis, and the smallest it can be before the DS's 8-bit fraction can no longer tell it from nothing. */
export const SPRITE_SCALE_MAX = 8;
export const SPRITE_SCALE_MIN = 0.0625;
/** How many sprites of a screen can rotate or scale: the DS has 32 rotation matrices for each 2D engine. */
export const MAX_ROTATING_SPRITES = 32;

export const DEFAULT_SPRITE_TRANSFORM: Readonly<SpriteTransformData> = { rotation: 0, scale: { x: 1, y: 1 } };

/** A scale kept between the limits, its sign (a flip) preserved; zero is read as the smallest scale. */
export function clampSpriteScale(value: number): number {
  const magnitude = Math.min(SPRITE_SCALE_MAX, Math.max(SPRITE_SCALE_MIN, Math.abs(value)));
  return value < 0 ? -magnitude : magnitude;
}

export function normalizeSpriteTransform(data: SpriteTransformData): SpriteTransformData {
  return { rotation: data.rotation, scale: { x: clampSpriteScale(data.scale.x), y: clampSpriteScale(data.scale.y) } };
}

/** A node's rotation and scale with the defaults filled in and the scale limited. */
export function getSpriteTransform(node: { transform2D?: { rotation?: number; scale?: Partial<Vector2> } }): SpriteTransformData {
  const data = node.transform2D ?? {};
  return normalizeSpriteTransform({
    rotation: data.rotation ?? DEFAULT_SPRITE_TRANSFORM.rotation,
    scale: { x: data.scale?.x ?? DEFAULT_SPRITE_TRANSFORM.scale.x, y: data.scale?.y ?? DEFAULT_SPRITE_TRANSFORM.scale.y }
  });
}

/** Whether the picture is drawn as it is (no rotation, scale 1): such a sprite needs no rotation matrix unless a script can change it. */
export function isUpright(transform: SpriteTransformData): boolean {
  return transform.rotation === 0 && transform.scale.x === 1 && transform.scale.y === 1;
}
