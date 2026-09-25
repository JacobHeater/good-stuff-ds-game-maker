import { getAudioPlayer } from "./audio-player";
import { is3DNodeKind, type SceneNode, type SceneNodeKind, type Vector3 } from "./scene-node";

/**
 * What an AnimationPlayer has beyond being a node (requirements/animation/TASK.animation-model-and-persistence.md): named animations, each a set of tracks that
 * keyframe one property of one node over time. Every field is optional in a saved file (a node without `animation` has no animations).
 */

/** The properties a track can animate. */
export type AnimationProperty = "position" | "rotation" | "scale" | "visible" | "volume" | "pitch";
export const ANIMATION_PROPERTIES: readonly AnimationProperty[] = ["position", "rotation", "scale", "visible", "volume", "pitch"];

/** The kind of value a property holds: a vector (X/Y/Z), a bool, or a number. */
export type AnimationValueKind = "vector" | "bool" | "number";
export function valueKindOf(property: AnimationProperty): AnimationValueKind {
  if (property === "position" || property === "rotation" || property === "scale") return "vector";
  return property === "visible" ? "bool" : "number";
}

export type AnimationValue = Vector3 | number | boolean;

export interface AnimationKey {
  /** Seconds from the start of the animation, `0..length`. */
  time: number;
  value: AnimationValue;
}

export interface AnimationTrack {
  id: string;
  /** The animated node, by id (so a rename doesn't break it). */
  nodeId: string;
  property: AnimationProperty;
  /** Sorted by time, no two at the same time. */
  keys: AnimationKey[];
}

export interface Animation {
  id: string;
  name: string;
  /** Seconds. */
  length: number;
  loop: boolean;
  tracks: AnimationTrack[];
}

export interface AnimationPlayerData {
  /** The id of the animation that starts with the game. */
  autoplay?: string;
  /** Playback speed multiplier, `ANIMATION_SPEED_MIN`..`ANIMATION_SPEED_MAX`. */
  speed: number;
  animations: Animation[];
}

export const ANIMATION_LENGTH_MIN = 0.1;
export const ANIMATION_LENGTH_MAX = 600;
export const ANIMATION_SPEED_MIN = 0.05;
export const ANIMATION_SPEED_MAX = 10;
export const DEFAULT_ANIMATION_LENGTH = 1;

/** A player's data with the defaults filled in. */
export function getAnimationPlayer(node: { animation?: Partial<AnimationPlayerData> }): AnimationPlayerData {
  const data = node.animation ?? {};
  return {
    ...(data.autoplay !== undefined ? { autoplay: data.autoplay } : {}),
    speed: data.speed ?? 1,
    animations: data.animations ?? []
  };
}

export const clampAnimationLength = (length: number): number => Math.min(ANIMATION_LENGTH_MAX, Math.max(ANIMATION_LENGTH_MIN, length));
export const clampAnimationSpeed = (speed: number): number => Math.min(ANIMATION_SPEED_MAX, Math.max(ANIMATION_SPEED_MIN, speed));

/** The properties a node of `kind` has that an animation can change. */
export function animatableProperties(kind: SceneNodeKind): AnimationProperty[] {
  if (kind === "AudioStreamPlayer") return ["volume", "pitch"];
  if (is3DNodeKind(kind)) return ["position", "rotation", "scale", "visible"];
  return [];
}

/** What `node` has for `property` now: the value a new key starts with. */
export function currentValueOf(node: SceneNode, property: AnimationProperty): AnimationValue {
  switch (property) {
    case "position":
    case "rotation":
    case "scale": {
      const vector = node.transform3D?.[property];
      return vector ? { x: vector.x, y: vector.y, z: vector.z } : property === "scale" ? { x: 1, y: 1, z: 1 } : { x: 0, y: 0, z: 0 };
    }
    case "visible":
      return node.visible;
    case "volume":
      return getAudioPlayer(node).volume;
    case "pitch":
      return getAudioPlayer(node).pitch;
  }
}

/** Whether `value` is the kind `property` holds (a finite number, or three of them, or a bool). */
export function isValueForProperty(property: AnimationProperty, value: unknown): value is AnimationValue {
  const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
  switch (valueKindOf(property)) {
    case "vector": {
      const v = value as Partial<Vector3> | null;
      return typeof v === "object" && v !== null && finite(v.x) && finite(v.y) && finite(v.z);
    }
    case "bool":
      return typeof value === "boolean";
    case "number":
      return finite(value);
  }
}

/** The value of a track at `time` seconds: a straight-line blend between keys, the first key's value before the first and the last key's after the last; a bool is stepped. */
export function sampleTrack(track: Pick<AnimationTrack, "property" | "keys">, time: number): AnimationValue | undefined {
  const keys = track.keys;
  if (keys.length === 0) return undefined;
  if (time <= keys[0].time) return cloneValue(keys[0].value);
  const last = keys[keys.length - 1];
  if (time >= last.time) return cloneValue(last.value);
  let after = 1;
  while (keys[after].time <= time) after++;
  const a = keys[after - 1];
  const b = keys[after];
  const kind = valueKindOf(track.property);
  if (kind === "bool") return a.value;
  const t = (time - a.time) / (b.time - a.time);
  if (kind === "number") return (a.value as number) + ((b.value as number) - (a.value as number)) * t;
  const av = a.value as Vector3;
  const bv = b.value as Vector3;
  return { x: av.x + (bv.x - av.x) * t, y: av.y + (bv.y - av.y) * t, z: av.z + (bv.z - av.z) * t };
}

function cloneValue(value: AnimationValue): AnimationValue {
  return typeof value === "object" ? { x: value.x, y: value.y, z: value.z } : value;
}

/** Every track's value at `time`. Tracks with no keys are left out. */
export function sampleAnimation(animation: Pick<Animation, "tracks">, time: number): Array<{ track: AnimationTrack; value: AnimationValue }> {
  const out: Array<{ track: AnimationTrack; value: AnimationValue }> = [];
  for (const track of animation.tracks) {
    const value = sampleTrack(track, time);
    if (value !== undefined) out.push({ track, value });
  }
  return out;
}

/** `Animation`, `Animation2`, ... for a new animation. */
export function uniqueAnimationName(existing: readonly string[], base = "Animation"): string {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** The key times of a track after `time` is inserted or moved: keeps the keys sorted, and refuses (returns null) a time another key already has. */
export function insertKey(keys: readonly AnimationKey[], key: AnimationKey): AnimationKey[] | null {
  if (keys.some((existing) => existing.time === key.time)) return null;
  return [...keys, key].sort((a, b) => a.time - b.time);
}

/** The tracks of `animations` with those that target any of `nodeIds` removed. */
export function withoutTracksFor(animations: readonly Animation[], nodeIds: ReadonlySet<string>): Animation[] {
  return animations.map((animation) => (animation.tracks.some((track) => nodeIds.has(track.nodeId)) ? { ...animation, tracks: animation.tracks.filter((track) => !nodeIds.has(track.nodeId)) } : animation));
}
