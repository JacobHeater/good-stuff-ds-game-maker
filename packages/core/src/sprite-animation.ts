/**
 * The animations of an `AnimatedSprite2D` (requirements/scene-designer/STORY.animated-sprites.md): named lists of frames of the sprite sheet the node draws, played at a
 * speed, once or looping. The sheet is an `ImportedSprite` with a frame size (`imported-sprite.ts`); a frame is its number in the sheet, counted left to right, top to bottom,
 * from 0. A node plays its `start` animation from the moment the scene starts (a script can play another, or stop it, in a 3D project).
 */

export interface SpriteAnimation {
  /** What a script calls it (`$Hero.play("run")`); unique on the node. */
  name: string;
  /** The frames shown in order (a frame may appear more than once). */
  frames: number[];
  /** Frames a second. */
  fps: number;
  /** Start again after the last frame; otherwise it stops on it. */
  loop: boolean;
}

export interface SpriteAnimationsData {
  animations: SpriteAnimation[];
  /** The name of the animation that plays when the scene starts; absent: none plays, and the node shows the first frame of the sheet. */
  start?: string;
}

export const MIN_SPRITE_ANIMATION_FPS = 1;
export const MAX_SPRITE_ANIMATION_FPS = 60;
export const DEFAULT_SPRITE_ANIMATION_FPS = 8;

export function createSpriteAnimation(name: string, frames: number[] = [0]): SpriteAnimation {
  return { name, frames, fps: DEFAULT_SPRITE_ANIMATION_FPS, loop: true };
}

/** A speed between the limits (a fractional one is fine). */
export function clampSpriteAnimationFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_SPRITE_ANIMATION_FPS;
  return Math.min(MAX_SPRITE_ANIMATION_FPS, Math.max(MIN_SPRITE_ANIMATION_FPS, fps));
}

/** A node's animations with the defaults filled in and the speeds limited. Absent means none. */
export function getSpriteAnimations(node: { spriteAnimations?: Partial<SpriteAnimationsData> }): SpriteAnimationsData {
  const data = node.spriteAnimations ?? {};
  const animations = (data.animations ?? []).map((animation) => ({
    name: animation.name,
    frames: [...animation.frames],
    fps: clampSpriteAnimationFps(animation.fps),
    loop: animation.loop ?? true
  }));
  return { animations, ...(data.start !== undefined && animations.some((animation) => animation.name === data.start) ? { start: data.start } : {}) };
}

/** A name for a new animation that no other one on the node has: "anim", "anim2", ... */
export function nextAnimationName(existing: readonly { name: string }[], base = "anim"): string {
  const taken = new Set(existing.map((animation) => animation.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * Reads a list of frames the way people write them: "0, 1, 2, 3", or a range "0-3", or a mix, "0-3, 5, 3-1" (a range can go down). Spaces don't matter. Every frame must be
 * in the sheet (0 up to `frameCount - 1`).
 */
export function parseFrameList(text: string, frameCount: number): { ok: true; frames: number[] } | { ok: false; error: string } {
  const frames: number[] = [];
  const parts = text.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, error: "Type at least one frame number, for example 0-3." };
  for (const part of parts) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const single = /^\d+$/.exec(part);
    if (!range && !single) return { ok: false, error: `"${part}" isn't a frame number or a range like 0-3.` };
    const from = Number(range ? range[1] : part);
    const to = Number(range ? range[2] : part);
    for (const frame of [from, to]) {
      if (frame >= frameCount) return { ok: false, error: `Frame ${frame} isn't in the sheet, which has ${frameCount} frame${frameCount === 1 ? "" : "s"} (0 to ${frameCount - 1}).` };
    }
    const step = from <= to ? 1 : -1;
    for (let frame = from; frame !== to + step; frame += step) frames.push(frame);
  }
  return { ok: true, frames };
}

/** The reverse of `parseFrameList`: runs of consecutive frames written as ranges, "0-3, 5". */
export function formatFrameList(frames: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < frames.length) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1] === frames[j] + 1) j++;
    parts.push(j - i >= 2 ? `${frames[i]}-${frames[j]}` : frames.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}
