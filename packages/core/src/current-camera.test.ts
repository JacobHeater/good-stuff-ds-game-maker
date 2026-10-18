import { describe, expect, it } from "vitest";

import { CAMERA_FAR_PLANE_DEFAULT, CAMERA_FAR_PLANE_MAX, CAMERA_FAR_PLANE_MIN, getCameraFarPlane, isCurrentCamera } from "./scene-node";

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

describe("a Camera3D's far clip plane", () => {
  it("defaults to CAMERA_FAR_PLANE_DEFAULT when nothing is saved", () => {
    expect(getCameraFarPlane({})).toBe(CAMERA_FAR_PLANE_DEFAULT);
    expect(getCameraFarPlane({ camera: {} })).toBe(CAMERA_FAR_PLANE_DEFAULT);
  });

  it("is clamped to CAMERA_FAR_PLANE_MIN..CAMERA_FAR_PLANE_MAX", () => {
    expect(getCameraFarPlane({ camera: { farPlane: 1 } })).toBe(CAMERA_FAR_PLANE_MIN);
    expect(getCameraFarPlane({ camera: { farPlane: 5000 } })).toBe(CAMERA_FAR_PLANE_MAX);
    expect(getCameraFarPlane({ camera: { farPlane: 300 } })).toBe(300);
  });
});
