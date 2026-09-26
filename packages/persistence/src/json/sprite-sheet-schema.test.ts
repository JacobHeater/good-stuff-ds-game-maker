import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

const madeSheet = createSpriteFromRgba(new Uint8Array(64 * 16 * 4).fill(255), 64, 16, { name: "run", frame: { width: 16, height: 16 } });
if (!madeSheet.ok) throw new Error("sheet fixture didn't convert");
const sheet: ImportedSprite = { id: "sheet-1", ...madeSheet.sprite };

function projectWithSheet(): ProjectSnapshot {
  const node = createSceneNode({ name: "Hero", kind: "AnimatedSprite2D" });
  node.spriteId = sheet.id;
  node.spriteAnimations = {
    animations: [
      { name: "run", frames: [0, 1, 2, 3], fps: 10, loop: true },
      { name: "jump", frames: [2], fps: 8, loop: false }
    ],
    start: "run"
  };
  const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sprites: [sheet] };
}

describe("sprite sheets and animations in the project file", () => {
  it("saves and reopens a sheet with its frame size and the animations that use it, identically", () => {
    const original = projectWithSheet();
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(original)));
    expect(reopened.sprites).toEqual([sheet]);
    expect(reopened.sprites?.[0]).toMatchObject({ frameWidth: 16, frameHeight: 16 });
    expect(reopened.scene.children[0].spriteAnimations).toEqual(original.scene.children[0].spriteAnimations);
  });

  it("keeps a sheet that only an AnimatedSprite2D uses when saving", () => {
    expect(serializer.serialize(projectWithSheet())).toContain("frameWidth");
  });

  it("rejects a frame size with only one number, one that isn't a sprite size and one the sheet doesn't divide by", () => {
    const project = projectWithSheet();
    project.sprites = [{ ...sheet, frameHeight: undefined }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/only one of frameWidth and frameHeight/);
    project.sprites = [{ ...sheet, frameWidth: 24, frameHeight: 16 }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/frames of 24 x 16/);
    project.sprites = [{ ...sheet, frameWidth: 32, frameHeight: 16, width: 48 }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/whole number of 32 x 16 frames/);
  });

  it("rejects two animations with one name, a frame the sheet doesn't have, a start that names nothing and a speed off the scale", () => {
    const project = projectWithSheet();
    const node = project.scene.children[0];
    node.spriteAnimations = { animations: [{ name: "run", frames: [0], fps: 8, loop: true }, { name: "run", frames: [1], fps: 8, loop: true }] };
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/two animations called "run"/);
    node.spriteAnimations = { animations: [{ name: "run", frames: [0, 4], fps: 8, loop: true }] };
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/shows frame 4, but the sheet has 4 frames/);
    node.spriteAnimations = { animations: [{ name: "run", frames: [0], fps: 8, loop: true }], start: "walk" };
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/starts with the animation "walk"/);
    node.spriteAnimations = { animations: [{ name: "run", frames: [0], fps: 99, loop: true }] };
    expect(validator.validate(roundTrip(project)).valid).toBe(false);
  });
});
