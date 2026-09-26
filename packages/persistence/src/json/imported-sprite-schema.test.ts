import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, withUpdatedScene, type ImportedSprite, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

const picture = new Uint8Array(16 * 16 * 4).fill(200);
const made = createSpriteFromRgba(picture, 16, 16, { name: "hero" });
if (!made.ok) throw new Error("fixture didn't convert");
const sprite: ImportedSprite = { id: "spr-1", ...made.sprite };

function projectWithSprite(): ProjectSnapshot {
  const node = createSceneNode({ name: "Hero", kind: "Sprite2D" });
  node.spriteId = sprite.id;
  const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sprites: [sprite] };
}
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

describe("sprite images in the project file", () => {
  it("leaves a project with no sprites unchanged: no sprites key, still valid", () => {
    const plain = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D" }) });
    expect(serializer.serialize(withUpdatedScene(plain, plain.scene))).not.toContain("sprites");
    expect(validator.validate(roundTrip(plain)).valid).toBe(true);
  });

  it("saves and reopens an image and the sprite that uses it, identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(projectWithSprite())));
    expect(reopened.sprites).toEqual([sprite]);
    expect(reopened.scene.children[0].spriteId).toBe("spr-1");
  });

  it("rejects a sprite that names an image the file doesn't contain, naming the sprite", () => {
    const project = projectWithSprite();
    delete project.sprites;
    const issues = issuesOf(roundTrip(project));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Sprite "Hero".*spr-1.*isn't in the project file/);
  });

  it("rejects a size the DS has no sprite for", () => {
    const project = projectWithSprite();
    project.sprites = [{ ...sprite, width: 24, height: 24 }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/24 x 24, but a sprite must be one of/);
  });

  it("rejects pixel data of the wrong length and bad base64", () => {
    const project = projectWithSprite();
    project.sprites = [{ ...sprite, pixels: "AAAA" }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/holds 3 bytes, but a 16 x 16 sprite needs 256/);
    project.sprites = [{ ...sprite, palette: "not base64!" }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/palette isn't valid base64/);
  });

  it("rejects a pixel whose palette index is past the palette", () => {
    const project = projectWithSprite();
    // A palette of 2 entries (4 bytes) with pixels that are all index 5.
    project.sprites = [{ ...sprite, palette: "AAAAAA==", pixels: btoa(String.fromCharCode(...new Array(256).fill(5))) }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/palette index past the palette's 2 colors/);
  });

  it("rejects two images with the same id", () => {
    const project = projectWithSprite();
    project.sprites = [sprite, { ...sprite }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/id "spr-1", which another sprite image already uses/);
  });
});
