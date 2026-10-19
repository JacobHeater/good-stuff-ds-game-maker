import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

const madeSheet = createSpriteFromRgba(new Uint8Array(16 * 8 * 4).fill(255), 16, 8, { name: "icons", frame: { width: 8, height: 8 } });
if (!madeSheet.ok) throw new Error("icon sheet fixture didn't convert");
const sheet: ImportedSprite = { id: "icons", ...madeSheet.sprite };

function projectWithItems(items?: unknown, itemIconsSpriteId = sheet.id): ProjectSnapshot {
  const node = createSceneNode({ name: "Bag", kind: "Inventory" });
  const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
  const project: ProjectSnapshot = { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sprites: [sheet], itemIconsSpriteId };
  if (items !== undefined) (project as unknown as { items: unknown }).items = items;
  return project;
}

describe("the project's shared item list (STORY.inventory.md)", () => {
  it("accepts a project with no items saved (a brand new one)", () => {
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene });
    expect(validator.validate(project).valid).toBe(true);
    expect(JSON.stringify(project)).not.toContain("items");
  });

  it("round-trips items with and without an icon frame", () => {
    const items = [{ id: "sword", name: "Sword", iconFrame: 0, maxStack: 1 }, { id: "potion", name: "Potion", maxStack: 99 }];
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithItems(items))));
    expect(reopened.items).toEqual(items);
    expect(reopened.itemIconsSpriteId).toBe("icons");
  });

  it("rejects a maxStack outside 1..999, and unknown fields", () => {
    expect(validator.validate(projectWithItems([{ id: "x", name: "X", maxStack: 0 }])).valid).toBe(false);
    expect(validator.validate(projectWithItems([{ id: "x", name: "X", maxStack: 1000 }])).valid).toBe(false);
    expect(validator.validate(projectWithItems([{ id: "x", name: "X", maxStack: 1, weight: 5 }])).valid).toBe(false);
  });

  it("rejects two items with the same id", () => {
    const items = [{ id: "sword", name: "Sword", maxStack: 1 }, { id: "sword", name: "Sword2", maxStack: 1 }];
    expect(issuesOf(roundTrip(projectWithItems(items))).join(" ")).toMatch(/two entries? with the id "sword"|another item already uses/);
  });

  it("rejects two items with the same name (what a script's add(\"name\") would resolve against)", () => {
    const items = [{ id: "a", name: "Sword", maxStack: 1 }, { id: "b", name: "Sword", maxStack: 1 }];
    expect(issuesOf(roundTrip(projectWithItems(items))).join(" ")).toMatch(/named "Sword", which another item already uses/);
  });

  it("rejects an iconFrame past the icon sheet's own frame count", () => {
    const issues = issuesOf(roundTrip(projectWithItems([{ id: "sword", name: "Sword", iconFrame: 2, maxStack: 1 }])));
    expect(issues.join(" ")).toMatch(/shows icon frame 2, but the icon sheet has 2 frames/);
  });

  it("rejects an itemIconsSpriteId naming a sprite the project doesn't have", () => {
    const project = projectWithItems([{ id: "sword", name: "Sword", maxStack: 1 }], "ghost");
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/itemIconsSpriteId "ghost" isn't in the project file/);
  });
});

describe("an Inventory's own on-screen panel (STORY.inventory-ui-panel.md)", () => {
  function projectWithPanel(inventory?: unknown): ProjectSnapshot {
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    if (inventory !== undefined) (node as unknown as { inventory: unknown }).inventory = inventory;
    const scene = createSceneNode({ name: "Main", kind: "Node2D", children: [node] });
    return { ...createProjectSnapshot({ name: "P", mode: "2D", scene }), sprites: [sheet] };
  }

  it("accepts an Inventory with no panel saved (a brand new one)", () => {
    const project = projectWithPanel();
    expect(validator.validate(project).valid).toBe(true);
    expect(JSON.stringify(project)).not.toContain("columns");
  });

  it("round-trips the three panel images, columns and spacing", () => {
    const inventory = { slots: 10, backgroundSpriteId: "icons", slotSpriteId: "icons", highlightSpriteId: "icons", columns: 3, slotSpacingX: 4, slotSpacingY: 6 };
    const reopened = validator.assertValid(serializer.deserialize(JSON.stringify(projectWithPanel(inventory))));
    expect(reopened.scene.children[0].inventory).toEqual(inventory);
  });

  it("rejects columns/spacing out of range, and unknown fields", () => {
    expect(validator.validate(projectWithPanel({ columns: 0 })).valid).toBe(false);
    expect(validator.validate(projectWithPanel({ columns: 65 })).valid).toBe(false);
    expect(validator.validate(projectWithPanel({ slotSpacingX: -1 })).valid).toBe(false);
    expect(validator.validate(projectWithPanel({ slotSpacingY: 33 })).valid).toBe(false);
    expect(validator.validate(projectWithPanel({ cornerRadius: 2 })).valid).toBe(false);
  });

  it("rejects a panel image naming a sprite the project doesn't have", () => {
    for (const field of ["backgroundSpriteId", "slotSpriteId", "highlightSpriteId"]) {
      const issues = issuesOf(roundTrip(projectWithPanel({ [field]: "ghost" })));
      expect(issues.join(" ")).toMatch(/Inventory "Bag" uses the .* image "ghost", which isn't in the project file/);
    }
  });
});
