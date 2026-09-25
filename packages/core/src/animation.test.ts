import { describe, expect, it } from "vitest";

import {
  animatableProperties,
  clampAnimationLength,
  clampAnimationSpeed,
  currentValueOf,
  getAnimationPlayer,
  insertKey,
  isValueForProperty,
  sampleAnimation,
  sampleTrack,
  uniqueAnimationName,
  valueKindOf,
  withoutTracksFor,
  type Animation,
  type AnimationKey
} from "./animation";
import { createSceneNode } from "./scene-node";

/** requirements/animation/TASK.animation-model-and-persistence.md */

const key = (time: number, value: AnimationKey["value"]): AnimationKey => ({ time, value });
const position = (...keys: AnimationKey[]) => ({ property: "position" as const, keys });

describe("sampling a track", () => {
  const track = position(key(0, { x: 0, y: 0, z: 0 }), key(2, { x: 10, y: 20, z: 30 }));

  it("blends in a straight line between keys", () => {
    expect(sampleTrack(track, 0.5)).toEqual({ x: 2.5, y: 5, z: 7.5 });
    expect(sampleTrack(track, 1)).toEqual({ x: 5, y: 10, z: 15 });
    expect(sampleTrack(track, 1.5)).toEqual({ x: 7.5, y: 15, z: 22.5 });
  });

  it("holds the first key's value before it and the last key's after it", () => {
    expect(sampleTrack(track, -1)).toEqual({ x: 0, y: 0, z: 0 });
    expect(sampleTrack(track, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(sampleTrack(track, 2)).toEqual({ x: 10, y: 20, z: 30 });
    expect(sampleTrack(track, 99)).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("is the one value of a single key at every time, and nothing for a track with no keys", () => {
    const single = position(key(1, { x: 4, y: 5, z: 6 }));
    for (const t of [0, 1, 3]) expect(sampleTrack(single, t)).toEqual({ x: 4, y: 5, z: 6 });
    expect(sampleTrack(position(), 1)).toBeUndefined();
  });

  it("blends across several segments, each in its own time span", () => {
    const three = { property: "volume" as const, keys: [key(0, 0), key(1, 1), key(3, 0)] };
    expect(sampleTrack(three, 0.5)).toBe(0.5);
    expect(sampleTrack(three, 1)).toBe(1);
    expect(sampleTrack(three, 2)).toBe(0.5);
    expect(sampleTrack(three, 3)).toBe(0);
  });

  it("steps a bool: the latest key at or before the time", () => {
    const flash = { property: "visible" as const, keys: [key(0, true), key(1, false), key(2, true)] };
    expect([0, 0.99, 1, 1.5, 2, 5].map((t) => sampleTrack(flash, t))).toEqual([true, true, false, false, true, true]);
    expect(sampleTrack({ property: "visible", keys: [key(1, false)] }, 0)).toBe(false); // before the first key: the first key's value
  });

  it("returns a copy, so what is sampled can be changed freely", () => {
    const value = sampleTrack(track, 0) as { x: number };
    value.x = 99;
    expect(track.keys[0].value).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("sampling an animation", () => {
  it("gives every track's value, leaving out tracks with no keys", () => {
    const animation: Pick<Animation, "tracks"> = {
      tracks: [
        { id: "a", nodeId: "n1", property: "scale", keys: [key(0, { x: 1, y: 1, z: 1 }), key(1, { x: 3, y: 3, z: 3 })] },
        { id: "b", nodeId: "n2", property: "visible", keys: [key(0.5, false)] },
        { id: "c", nodeId: "n3", property: "pitch", keys: [] }
      ]
    };
    const sampled = sampleAnimation(animation, 0.5);
    expect(sampled.map((s) => [s.track.id, s.value])).toEqual([["a", { x: 2, y: 2, z: 2 }], ["b", false]]);
  });
});

describe("properties and values", () => {
  it("says which properties a node kind can animate", () => {
    expect(animatableProperties("MeshInstance3D")).toEqual(["position", "rotation", "scale", "visible"]);
    expect(animatableProperties("Node3D")).toEqual(["position", "rotation", "scale", "visible"]);
    expect(animatableProperties("AudioStreamPlayer")).toEqual(["volume", "pitch"]);
    expect(animatableProperties("AnimationPlayer")).toEqual([]);
    expect(animatableProperties("Sprite2D")).toEqual([]);
  });

  it("has a kind of value for each property, and checks values against it", () => {
    expect(valueKindOf("position")).toBe("vector");
    expect(valueKindOf("visible")).toBe("bool");
    expect(valueKindOf("volume")).toBe("number");
    expect(isValueForProperty("position", { x: 1, y: 2, z: 3 })).toBe(true);
    expect(isValueForProperty("position", 3)).toBe(false);
    expect(isValueForProperty("position", { x: 1, y: 2 })).toBe(false);
    expect(isValueForProperty("visible", true)).toBe(true);
    expect(isValueForProperty("visible", 1)).toBe(false);
    expect(isValueForProperty("pitch", 1.5)).toBe(true);
    expect(isValueForProperty("pitch", NaN)).toBe(false);
    expect(isValueForProperty("pitch", true)).toBe(false);
  });

  it("gives the value a node has now, for a new key", () => {
    const mesh = createSceneNode({ name: "M", kind: "MeshInstance3D", transform3D: { position: { x: 1, y: 2, z: 3 }, scale: { x: 2, y: 2, z: 2 } } });
    expect(currentValueOf(mesh, "position")).toEqual({ x: 1, y: 2, z: 3 });
    expect(currentValueOf(mesh, "scale")).toEqual({ x: 2, y: 2, z: 2 });
    expect(currentValueOf(mesh, "rotation")).toEqual({ x: 0, y: 0, z: 0 });
    mesh.visible = false;
    expect(currentValueOf(mesh, "visible")).toBe(false);
    const sound = createSceneNode({ name: "S", kind: "AudioStreamPlayer" });
    sound.audio = { autoplay: true, volume: 0.4, pitch: 2, loop: false };
    expect(currentValueOf(sound, "volume")).toBe(0.4);
    expect(currentValueOf(sound, "pitch")).toBe(2);
    expect(currentValueOf(createSceneNode({ name: "P", kind: "AudioStreamPlayer" }), "volume")).toBe(1); // the default
  });
});

describe("a player's data", () => {
  it("has no animations and normal speed unless it says otherwise", () => {
    expect(getAnimationPlayer({})).toEqual({ speed: 1, animations: [] });
    expect(getAnimationPlayer({ animation: { speed: 2, autoplay: "a" } })).toEqual({ speed: 2, autoplay: "a", animations: [] });
  });

  it("keeps lengths and speeds in range", () => {
    expect([clampAnimationLength(0), clampAnimationLength(5), clampAnimationLength(9999)]).toEqual([0.1, 5, 600]);
    expect([clampAnimationSpeed(0), clampAnimationSpeed(2), clampAnimationSpeed(99)]).toEqual([0.05, 2, 10]);
  });

  it("names new animations Animation, Animation2, ...", () => {
    expect(uniqueAnimationName([])).toBe("Animation");
    expect(uniqueAnimationName(["Animation"])).toBe("Animation2");
    expect(uniqueAnimationName(["Animation", "Animation2", "Walk"])).toBe("Animation3");
    expect(uniqueAnimationName(["Walk"], "Walk")).toBe("Walk2");
  });

  it("inserts a key in time order and refuses a time another key already has", () => {
    const keys = [key(0, 0), key(2, 2)];
    expect(insertKey(keys, key(1, 1))!.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(insertKey(keys, key(3, 3))!.map((k) => k.time)).toEqual([0, 2, 3]);
    expect(insertKey(keys, key(-0, 9))).toBeNull();
    expect(keys).toHaveLength(2); // not changed
  });

  it("removes the tracks that target the given nodes, leaving other animations as they were (same objects)", () => {
    const a: Animation = { id: "a", name: "A", length: 1, loop: false, tracks: [{ id: "1", nodeId: "n1", property: "visible", keys: [] }, { id: "2", nodeId: "n2", property: "visible", keys: [] }] };
    const b: Animation = { id: "b", name: "B", length: 1, loop: false, tracks: [{ id: "3", nodeId: "n3", property: "visible", keys: [] }] };
    const result = withoutTracksFor([a, b], new Set(["n1"]));
    expect(result[0].tracks.map((t) => t.id)).toEqual(["2"]);
    expect(result[1]).toBe(b);
  });
});
