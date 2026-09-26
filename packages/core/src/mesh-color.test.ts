import { describe, expect, it } from "vitest";

import { getMeshDiffuseLevels, meshColorFromLevels, parseMeshColor } from "./mesh-color";

/** requirements/scene-designer/STORY.mesh-colors.md */

describe("a mesh's color", () => {
  it("is read as the 32 levels a channel the DS has", () => {
    expect(parseMeshColor("#000000")).toEqual([0, 0, 0]);
    expect(parseMeshColor("#ffffff")).toEqual([31, 31, 31]);
    expect(parseMeshColor("#ff8000")).toEqual([31, 16, 0]);
    expect(parseMeshColor("#FFD21F")).toEqual([31, 26, 4]);
  });

  it("is refused when it isn't #rrggbb", () => {
    for (const bad of [undefined, "", "red", "#fff", "#gggggg", "ffffff", "#ffffff00"]) expect(parseMeshColor(bad)).toBeNull();
  });

  it("goes back to a #rrggbb that reads as the same levels", () => {
    for (const levels of [[0, 0, 0], [31, 31, 31], [5, 17, 30], [24, 24, 24]] as const) expect(parseMeshColor(meshColorFromLevels(levels))).toEqual([...levels]);
  });

  it("defaults to grey, or white when the mesh has a texture", () => {
    expect(getMeshDiffuseLevels({}, false)).toEqual([24, 24, 24]);
    expect(getMeshDiffuseLevels({}, true)).toEqual([31, 31, 31]);
    expect(getMeshDiffuseLevels({ color: "#ff0000" }, true)).toEqual([31, 0, 0]);
    expect(getMeshDiffuseLevels({ color: "nonsense" }, false)).toEqual([24, 24, 24]);
  });
});
