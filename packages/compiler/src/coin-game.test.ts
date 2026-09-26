import { createCoinGameProject } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { translateProject3D } from "./translate-project";

/** requirements/scene-designer/STORY.coin-collector-example.md: the example game builds. */

describe("the coin collector example", () => {
  it("compiles without errors or warnings", () => {
    const { scenes, diagnostics } = translateProject3D(createCoinGameProject());
    expect(diagnostics).toEqual([]);
    expect(scenes).toHaveLength(1);
    expect(scenes![0].globals.map((g) => g.name)).toEqual(["best", "score"]);
  });
});
