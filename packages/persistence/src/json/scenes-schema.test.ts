import { createProjectSnapshot, createSceneNode, DEFAULT_START_SCENE_ID, withSceneEntries, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

function twoScenes(): ProjectSnapshot {
  const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D" }) });
  return withSceneEntries(project, [
    { id: DEFAULT_START_SCENE_ID, name: "Title", scene: project.scene, isStart: true },
    { id: "s2", name: "Level", scene: createSceneNode({ name: "Level1", kind: "Node2D", children: [createSceneNode({ name: "Hero", kind: "Sprite2D" })] }), isStart: false }
  ]);
}

describe("scenes in the project file", () => {
  it("writes nothing extra for a project with one scene", () => {
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D" }) });
    const text = serializer.serialize(project);
    expect(text).not.toContain("sceneName");
    expect(text).not.toContain("scenes");
    expect(validator.validate(roundTrip(project)).valid).toBe(true);
  });

  it("saves and reopens the starting scene's name and id and the other scenes, identically", () => {
    const original = twoScenes();
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(original)));
    expect(reopened.sceneName).toBe("Title");
    expect(reopened.scenes).toEqual(original.scenes);
    expect(reopened.scenes![0].scene.children[0].name).toBe("Hero");
  });

  it("rejects two scenes with one name (the start scene counts), a nameless scene and two with one id", () => {
    const project = twoScenes();
    project.scenes = [{ ...project.scenes![0], name: "Title" }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/Two scenes are called "Title"/);
    project.scenes = [{ ...project.scenes[0], name: "Level", id: DEFAULT_START_SCENE_ID }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/Two scenes have the id/);
    project.scenes = [{ ...project.scenes[0], id: "s2", name: "" }];
    expect(validator.validate(roundTrip(project)).valid).toBe(false); // the schema wants a name
  });

  it("checks the nodes of every scene: a sprite in another scene that names a missing image is refused, naming the node", () => {
    const project = twoScenes();
    project.scenes![0].scene.children[0].spriteId = "missing";
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/Sprite "Hero".*missing.*isn't in the project file/);
  });

  it("checks a script attached in another scene exists", () => {
    const project = twoScenes();
    project.scenes![0].scene.children[0].scriptId = "nope";
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/Node "Hero" uses the script "nope"/);
  });
});
