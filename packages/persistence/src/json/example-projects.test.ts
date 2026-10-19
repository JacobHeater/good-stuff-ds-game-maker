import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCoinGameProject, createIslandSurvivalProject } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The example projects are valid project files. Run with GSDS_WRITE_EXAMPLES=1 to (re)write them into the repository's `examples/` folder, where the editor's Open can find them.
 */
describe("the example projects", () => {
  it("the coin collector is a valid project file that reopens identically", () => {
    const project = createCoinGameProject();
    const text = serializer.serialize(project);
    const reopened = validator.assertValid(serializer.deserialize(text));
    expect(reopened.scripts?.map((s) => s.name)).toEqual(["Player", "Coin", "Chaser", "CameraFollow"]);
    expect(reopened.scene.children.filter((n) => /^Coin[0-9]/.test(n.name)).length).toBe(6);
    if (process.env.GSDS_WRITE_EXAMPLES) {
      const folder = resolve(HERE, "..", "..", "..", "..", "examples");
      mkdirSync(folder, { recursive: true });
      writeFileSync(resolve(folder, "coin-collector.gsds"), text);
    }
  });

  it("the island survival example is a valid project file that reopens identically", () => {
    const project = createIslandSurvivalProject();
    const text = serializer.serialize(project);
    const reopened = validator.assertValid(serializer.deserialize(text));
    expect(reopened.scripts?.map((s) => s.name)).toEqual(["World", "Player", "Tree", "Coconut", "Crab", "CameraFollow"]);
    expect(reopened.scene.children.filter((n) => /^Tree[0-9]/.test(n.name)).length).toBe(3);
    expect(reopened.items?.map((i) => i.name)).toEqual(["Wood", "Coconut"]);
    if (process.env.GSDS_WRITE_EXAMPLES) {
      const folder = resolve(HERE, "..", "..", "..", "..", "examples");
      mkdirSync(folder, { recursive: true });
      writeFileSync(resolve(folder, "island-survival.gsds"), text);
    }
  });
});
