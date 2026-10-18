import { describe, expect, it } from "vitest";

import { isCurrentSkyBox } from "./scene-node";

/** Which of a scene's SkyBox3D nodes is the default one (day/night cycles toggle each one's own ordinary visibility
 * instead -- requirements/scene-designer/STORY.sky-box.md). Mirrors current-camera.test.ts's own isCurrentCamera
 * tests, since isCurrentSkyBox is built to the exact same contract. */

describe("a scene's default sky box", () => {
  it("is the first SkyBox3D in tree order when none is explicitly marked", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(isCurrentSkyBox(a, [a, b])).toBe(true);
    expect(isCurrentSkyBox(b, [a, b])).toBe(false);
  });

  it("is whichever one is explicitly marked, even if it isn't first", () => {
    const a = { id: "a" };
    const b = { id: "b", skyBox: { current: true } };
    expect(isCurrentSkyBox(a, [a, b])).toBe(false);
    expect(isCurrentSkyBox(b, [a, b])).toBe(true);
  });

  it("a lone sky box is current whether or not it says so", () => {
    const a = { id: "a" };
    expect(isCurrentSkyBox(a, [a])).toBe(true);
    expect(isCurrentSkyBox({ id: "a", skyBox: { current: true } }, [a])).toBe(true);
  });
});
