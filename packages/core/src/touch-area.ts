import type { Vector3 } from "./scene-node";

/**
 * Touch areas: nodes that know whether the stylus is touching them (requirements/touch/STORY.touch-areas.md). Scripts ask each frame,
 * `is_touched()`, `is_touch_pressed()` and `is_touch_released()`, the same way they ask about buttons. Only the bottom screen senses touch.
 *
 * A **TouchArea2D** is a rectangle on the touch screen: `width` and `height` in screen pixels, centered on the node's `position` (as a sprite is).
 * A **TouchArea3D** is a box or sphere in the 3D scene: a ray from the camera through the touched point is tested against it, so a 3D object can be
 * touched. It needs the 3D engine to be on the bottom screen. Its size follows the node's own scale and its parents' scale, as a collision shape's does.
 *
 * Every field is optional in a saved file; a node without `touchArea2D` / `touchArea3D`, or without one of its fields, has the defaults below.
 */
export interface TouchArea2DData {
  /** Pixels, 1..256. */
  width: number;
  /** Pixels, 1..192. */
  height: number;
}

export type TouchArea3DShape = "box" | "sphere";
export const TOUCH_AREA_3D_SHAPES: readonly TouchArea3DShape[] = ["box", "sphere"];

export interface TouchArea3DData {
  shape: TouchArea3DShape;
  /** A box's full extents. */
  size: Vector3;
  /** A sphere's radius. */
  radius: number;
}

export const TOUCH_AREA_2D_MAX_WIDTH = 256;
export const TOUCH_AREA_2D_MAX_HEIGHT = 192;
export const TOUCH_AREA_3D_SIZE_MIN = 0.01;
export const TOUCH_AREA_3D_SIZE_MAX = 1000;

export const DEFAULT_TOUCH_AREA_2D: Readonly<TouchArea2DData> = { width: 64, height: 64 };
export const DEFAULT_TOUCH_AREA_3D: Readonly<TouchArea3DData> = { shape: "box", size: { x: 1, y: 1, z: 1 }, radius: 0.5 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A rectangle's size in whole pixels, at least 1 and no bigger than the screen. */
export function normalizeTouchArea2D(data: TouchArea2DData): TouchArea2DData {
  return {
    width: clamp(Math.round(data.width), 1, TOUCH_AREA_2D_MAX_WIDTH),
    height: clamp(Math.round(data.height), 1, TOUCH_AREA_2D_MAX_HEIGHT)
  };
}

export function getTouchArea2D(node: { touchArea2D?: Partial<TouchArea2DData> }): TouchArea2DData {
  const data = node.touchArea2D ?? {};
  return normalizeTouchArea2D({ width: data.width ?? DEFAULT_TOUCH_AREA_2D.width, height: data.height ?? DEFAULT_TOUCH_AREA_2D.height });
}

const size3D = (value: number): number => clamp(value, TOUCH_AREA_3D_SIZE_MIN, TOUCH_AREA_3D_SIZE_MAX);

export function normalizeTouchArea3D(data: TouchArea3DData): TouchArea3DData {
  return { shape: data.shape, size: { x: size3D(data.size.x), y: size3D(data.size.y), z: size3D(data.size.z) }, radius: size3D(data.radius) };
}

export function getTouchArea3D(node: { touchArea3D?: Partial<Omit<TouchArea3DData, "size">> & { size?: Partial<Vector3> } }): TouchArea3DData {
  const data = node.touchArea3D ?? {};
  return normalizeTouchArea3D({
    shape: data.shape ?? DEFAULT_TOUCH_AREA_3D.shape,
    size: { x: data.size?.x ?? DEFAULT_TOUCH_AREA_3D.size.x, y: data.size?.y ?? DEFAULT_TOUCH_AREA_3D.size.y, z: data.size?.z ?? DEFAULT_TOUCH_AREA_3D.size.z },
    radius: data.radius ?? DEFAULT_TOUCH_AREA_3D.radius
  });
}

/** The rectangle a TouchArea2D covers on its screen: top-left corner and size, in pixels (`position` is the center; the corner is rounded like a sprite's). */
export function getTouchArea2DRect(node: { position: { x: number; y: number }; touchArea2D?: Partial<TouchArea2DData> }): { x: number; y: number; width: number; height: number } {
  const { width, height } = getTouchArea2D(node);
  // (+ 0 turns a rounded -0 into 0.)
  return { x: Math.round(node.position.x - width / 2) + 0, y: Math.round(node.position.y - height / 2) + 0, width, height };
}
