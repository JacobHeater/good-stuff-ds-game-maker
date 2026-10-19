import { createProjectSnapshot, createSceneNode, type InventoryItem, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { hasErrors } from "./diagnostics";
import { cubeProject, scriptedProject } from "./fixtures";
import { NO_INVENTORY_PANEL, translateScene2D } from "./translate-scene-2d";
import { translateScene3D } from "./translate-scene-3d";

const sword: InventoryItem = { id: "sword", name: "Sword", iconFrame: 2, maxStack: 1 };
const potion: InventoryItem = { id: "potion", name: "Potion", maxStack: 99 };

describe("the project's shared item list compiles into every scene (STORY.inventory.md)", () => {
  it("is empty for a project with none", () => {
    const scene = translateScene3D(cubeProject()).scene!;
    expect(scene.items).toEqual([]);
  });

  it("compiles every project item, in order, regardless of whether any Inventory node exists", () => {
    const project = { ...cubeProject(), items: [sword, potion] };
    const scene = translateScene3D(project).scene!;
    expect(scene.items).toEqual([
      { iconFrame: 2, maxStack: 1 },
      { iconFrame: -1, maxStack: 99 }
    ]);
  });

  it("clamps an out-of-range maxStack", () => {
    const project = { ...cubeProject(), items: [{ id: "x", name: "X", maxStack: 5000 }] };
    const scene = translateScene3D(project).scene!;
    expect(scene.items[0].maxStack).toBe(999);
  });
});

describe("an Inventory node in a 3D project (STORY.inventory.md)", () => {
  it("has no inventories for a scene with none", () => {
    const scene = translateScene3D(cubeProject()).scene!;
    expect(scene.inventories).toEqual([]);
  });

  it("compiles a visible Inventory node even when no script touches it (unlike a 2D project)", () => {
    const project = cubeProject();
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    node.inventory = { slots: 5 };
    project.scene.children.push(node);
    const scene = translateScene3D(project).scene!;
    expect(scene.inventories).toHaveLength(1);
    const inv = scene.inventories[0];
    expect(scene.nodes[inv.node].name).toBe("Bag");
    expect(inv.slots).toBe(5);
  });

  it("clamps an out-of-range slot count", () => {
    const project = cubeProject();
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    node.inventory = { slots: 1000 };
    project.scene.children.push(node);
    const scene = translateScene3D(project).scene!;
    expect(scene.inventories[0].slots).toBe(64);
  });

  it("defaults to DEFAULT_INVENTORY_SLOTS with nothing saved", () => {
    const project = cubeProject();
    project.scene.children.push(createSceneNode({ name: "Bag", kind: "Inventory" }));
    const scene = translateScene3D(project).scene!;
    expect(scene.inventories[0].slots).toBe(20);
  });
});

function project2D(children: SceneNode[]): ProjectSnapshot {
  return createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) });
}

describe("an Inventory node in a 2D project (STORY.inventory.md)", () => {
  it("leaves an Inventory nothing reaches out of the ROM entirely, with no warning", () => {
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    const { scene, diagnostics } = translateScene2D(project2D([node]));
    expect(diagnostics).toEqual([]);
    expect(scene!.inventories).toEqual([]);
    expect(scene!.nodes).toEqual([]);
  });

  it("gives a script-named Inventory a node table entry and a GsInventory pointing at it", () => {
    const node = createSceneNode({ name: "Bag", kind: "Inventory" });
    node.inventory = { slots: 8 };
    node.scriptId = "s";
    const project: ProjectSnapshot = { ...project2D([node]), scripts: [{ id: "s", name: "S", source: "func _process(delta):\n    pass\n" }] };
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.nodes.map((n) => n.name)).toEqual(["Bag"]);
    expect(scene!.inventories).toEqual([{ node: 0, slots: 8, ...NO_INVENTORY_PANEL }]);
  });

  it("compiles the project's items the same way as a 3D project, independent of any Inventory node", () => {
    const project: ProjectSnapshot = { ...project2D([]), items: [sword, potion] };
    const scene = translateScene2D(project).scene!;
    expect(scene.items).toEqual([
      { iconFrame: 2, maxStack: 1 },
      { iconFrame: -1, maxStack: 99 }
    ]);
  });
});

describe("Inventory and set_frame script calls compile to the expected C (STORY.inventory.md)", () => {
  function compiled(source: string, attachTo: string[]) {
    const bag = createSceneNode({ name: "Bag", kind: "Inventory" });
    const hero = createSceneNode({ name: "Hero", kind: "Sprite2D" });
    const project: ProjectSnapshot = { ...scriptedProject([{ source, attachTo }], [bag, hero]), items: [sword, potion] };
    const result = translateScene3D(project);
    if (hasErrors(result.diagnostics)) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
    return result.scene!;
  }

  it("add/remove/count call gs_inventory_* with the resolved item index and gs_node_inventory(node)", () => {
    const scene = compiled('func _process(delta):\n    $Bag.add("Sword", 1)\n    $Bag.remove("Sword", 2)\n    var n = $Bag.count("Potion")\n', ["Hero"]);
    const bagIndex = scene.nodes.findIndex((n) => n.name === "Bag");
    expect(scene.scriptCode).toContain(`gs_inventory_add(gs_node_inventory(${bagIndex}), 0, 1)`);
    expect(scene.scriptCode).toContain(`gs_inventory_remove(gs_node_inventory(${bagIndex}), 0, 2)`);
    expect(scene.scriptCode).toContain(`gs_inventory_count(gs_node_inventory(${bagIndex}), 1)`);
  });

  it("slot_count/slot_item_is/slot_icon call gs_inventory_* with the slot expression and resolved item", () => {
    const scene = compiled('func _process(delta):\n    var a = $Bag.slot_count(0)\n    var b = $Bag.slot_item_is(0, "Sword")\n    var c = $Bag.slot_icon(0)\n', ["Hero"]);
    const bagIndex = scene.nodes.findIndex((n) => n.name === "Bag");
    expect(scene.scriptCode).toContain(`gs_inventory_slot_count(gs_node_inventory(${bagIndex}), 0)`);
    expect(scene.scriptCode).toContain(`gs_inventory_slot_item_is(gs_node_inventory(${bagIndex}), 0, 0)`);
    expect(scene.scriptCode).toContain(`gs_inventory_slot_icon(gs_node_inventory(${bagIndex}), 0)`);
  });

  it("selected_slot()/select_slot(slot) (STORY.inventory-ui-panel.md) call gs_inventory_selected_slot/gs_inventory_select_slot with gs_node_inventory(node)", () => {
    const scene = compiled("func _process(delta):\n    var s = $Bag.selected_slot()\n    $Bag.select_slot(s)\n", ["Hero"]);
    const bagIndex = scene.nodes.findIndex((n) => n.name === "Bag");
    expect(scene.scriptCode).toContain(`gs_inventory_selected_slot(gs_node_inventory(${bagIndex}))`);
    expect(scene.scriptCode).toMatch(new RegExp(`gs_inventory_select_slot\\(gs_node_inventory\\(${bagIndex}\\), v_s\\)`));
  });

  it("set_frame(frame) calls gs_sprite_set_frame(node, frame)", () => {
    const scene = compiled("func _process(delta):\n    $Hero.set_frame(2)\n", ["Hero"]);
    const heroIndex = scene.nodes.findIndex((n) => n.name === "Hero");
    expect(scene.scriptCode).toContain(`gs_sprite_set_frame(${heroIndex}, 2)`);
  });

  it("fails the whole compile when an item name doesn't exist, the same as any other script error", () => {
    const bag = createSceneNode({ name: "Bag", kind: "Inventory" });
    const project: ProjectSnapshot = { ...scriptedProject([{ source: 'func _process(delta):\n    $Bag.add("Ghost", 1)\n' }], [bag]), items: [sword] };
    const result = translateScene3D(project);
    expect(result.scene).toBeNull();
    expect(result.diagnostics.some((d) => d.severity === "error" && d.message.includes('no item "Ghost"'))).toBe(true);
  });
});
