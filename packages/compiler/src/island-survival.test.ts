import { createIslandSurvivalProject } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { translateProject3D } from "./translate-project";

/** requirements/scene-designer/STORY.island-survival-example.md: the example game builds. */

describe("the island survival example", () => {
  it("compiles without errors or warnings", () => {
    const { scenes, diagnostics } = translateProject3D(createIslandSurvivalProject());
    expect(diagnostics).toEqual([]);
    // The project's two scene entries: the playable "Island" and the campfire spawn pool's own template scene.
    expect(scenes).toHaveLength(2);
    expect(scenes![0].globals.map((g) => g.name).sort()).toEqual(["bestDay", "day", "lastFire", "lives"]);
    expect(scenes![0].spawnPools).toHaveLength(1);
    expect(scenes![0].spawnPools[0].count).toBe(3);
  });
});
