import { describe, expect, it } from "vitest";

import { DS_HARDWARE_PROFILE, triangleBudgetFor } from "./hardware";

describe("the triangle budget at a frame rate", () => {
  it("is the DS's plain per-frame budget at 60fps", () => {
    expect(triangleBudgetFor(60)).toBe(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame);
  });

  it("doubles at 30fps, since the GPU gets twice as long per frame", () => {
    expect(triangleBudgetFor(30)).toBe(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame * 2);
  });

  it("quadruples at 15fps", () => {
    expect(triangleBudgetFor(15)).toBe(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame * 4);
  });

  it("grows by a third at 45fps", () => {
    expect(triangleBudgetFor(45)).toBe(Math.round(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame * (60 / 45)));
  });
});

describe("supported FPS targets", () => {
  it("offers 15, 30, 45 and 60, with 60 as the default", () => {
    expect(DS_HARDWARE_PROFILE.frameRate.supportedFpsTargets).toEqual([15, 30, 45, 60]);
    expect(DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget).toBe(60);
  });
});
