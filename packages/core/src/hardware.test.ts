import { describe, expect, it } from "vitest";

import { DS_HARDWARE_PROFILE, triangleBudgetFor } from "./hardware";

describe("the triangle budget at a frame rate", () => {
  it("is the DS's plain per-frame budget at 60fps", () => {
    expect(triangleBudgetFor(60)).toBe(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame);
  });

  it("doubles at 30fps, since the GPU gets twice as long per frame", () => {
    expect(triangleBudgetFor(30)).toBe(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame * 2);
  });
});
