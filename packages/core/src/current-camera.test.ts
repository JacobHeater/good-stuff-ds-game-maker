import { describe, expect, it } from "vitest";

import { isCurrentCamera } from "./scene-node";

/** requirements/scene-designer/STORY.current-camera.md: which of a scene's Camera3D nodes is the active one. */

describe("a scene's current camera", () => {
  it("is the first Camera3D in tree order when none is explicitly marked", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(isCurrentCamera(a, [a, b])).toBe(true);
    expect(isCurrentCamera(b, [a, b])).toBe(false);
  });

  it("is whichever one is explicitly marked, even if it isn't first", () => {
    const a = { id: "a" };
    const b = { id: "b", camera: { current: true } };
    expect(isCurrentCamera(a, [a, b])).toBe(false);
    expect(isCurrentCamera(b, [a, b])).toBe(true);
  });

  it("a lone camera is current whether or not it says so", () => {
    const a = { id: "a" };
    expect(isCurrentCamera(a, [a])).toBe(true);
    expect(isCurrentCamera({ id: "a", camera: { current: true } }, [a])).toBe(true);
  });
});
