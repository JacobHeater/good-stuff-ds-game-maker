import { describe, expect, it } from "vitest";

import { clampSpriteScale, getSpriteTransform, isUpright, SPRITE_SCALE_MAX, SPRITE_SCALE_MIN } from "./sprite-transform";

describe("a sprite's rotation and scale", () => {
  it("is upright and unscaled when nothing is saved, and fills in a missing field", () => {
    expect(getSpriteTransform({})).toEqual({ rotation: 0, scale: { x: 1, y: 1 } });
    expect(isUpright(getSpriteTransform({}))).toBe(true);
    expect(getSpriteTransform({ transform2D: { rotation: 30 } })).toEqual({ rotation: 30, scale: { x: 1, y: 1 } });
    expect(getSpriteTransform({ transform2D: { scale: { y: 2 } } })).toEqual({ rotation: 0, scale: { x: 1, y: 2 } });
    expect(isUpright(getSpriteTransform({ transform2D: { rotation: 30 } }))).toBe(false);
    expect(isUpright(getSpriteTransform({ transform2D: { scale: { x: -1 } } }))).toBe(false);
  });

  it("keeps a scale between 1/16 and 8 times, with its sign (a flip)", () => {
    expect(clampSpriteScale(100)).toBe(SPRITE_SCALE_MAX);
    expect(clampSpriteScale(-100)).toBe(-SPRITE_SCALE_MAX);
    expect(clampSpriteScale(0)).toBe(SPRITE_SCALE_MIN);
    expect(clampSpriteScale(-0.001)).toBe(-SPRITE_SCALE_MIN);
    expect(clampSpriteScale(1.5)).toBe(1.5);
  });

  it("does not limit the angle: 720 degrees is a value like any other", () => {
    expect(getSpriteTransform({ transform2D: { rotation: 720 } }).rotation).toBe(720);
  });
});
