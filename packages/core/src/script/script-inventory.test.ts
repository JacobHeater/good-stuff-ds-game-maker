import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** requirements/scene-designer/STORY.inventory.md: add/remove/count/slot_count/slot_item_is/slot_icon on an Inventory, and set_frame() on a sprite.
 * requirements/scene-designer/STORY.inventory-ui-panel.md: selected_slot()/select_slot(slot) on an Inventory's own on-screen panel. */

function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node2D",
    children: [
      createSceneNode({ name: "Bag", kind: "Inventory" }),
      createSceneNode({ name: "Hero", kind: "Sprite2D" }),
      createSceneNode({ name: "Enemy", kind: "AnimatedSprite2D" }),
      createSceneNode({ name: "Shape", kind: "CollisionShape2D" })
    ]
  });
}
type Attached = ScriptSceneContext["attached"];
const attachedTo = (...kinds: SceneNodeKind[]): Attached => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached: Attached = attachedTo("Sprite2D"), items: readonly string[] = ["sword", "potion"], root = scene()): ScriptCheckResult =>
  checkScript(source, { root, attached, items });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("add/remove/count/slot_count/slot_item_is/slot_icon on an Inventory", () => {
  it("accepts add(item, count), remove(item, count) and count(item), resolving the item to its project index", () => {
    const r = check('func _process(delta):\n    $Bag.add("sword", 1)\n    $Bag.remove("sword", 1)\n    var n = $Bag.count("potion")\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    const add = (body[0] as { kind: "expr"; expr: { res?: unknown } }).expr;
    expect(add.res).toMatchObject({ kind: "inventoryCall", method: "add", item: 0, target: { kind: "node", name: "Bag" } });
    const remove = (body[1] as { kind: "expr"; expr: { res?: unknown } }).expr;
    expect(remove.res).toMatchObject({ kind: "inventoryCall", method: "remove", item: 0 });
    const countDecl = body[2] as { kind: "var"; init: { res?: unknown } };
    expect(countDecl.init.res).toMatchObject({ kind: "inventoryCall", method: "count", item: 1 });
  });

  it("accepts slot_count(slot), slot_item_is(slot, item) and slot_icon(slot)", () => {
    const r = check('func _process(delta):\n    var a = $Bag.slot_count(0)\n    var b = $Bag.slot_item_is(0, "sword")\n    var c = $Bag.slot_icon(0)\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    expect((body[0] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "inventoryCall", method: "slot_count" });
    expect((body[1] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "inventoryCall", method: "slot_item_is", item: 0 });
    expect((body[2] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "inventoryCall", method: "slot_icon" });
  });

  it("works on self for a script attached to an Inventory, called plainly or with self.", () => {
    const r = check('func f():\n    add("sword", 1)\n    self.remove("sword", 1)\n', attachedTo("Inventory"));
    expect(errors(r)).toEqual([]);
  });

  it("is an error to name something that isn't an Inventory, saying what to do", () => {
    const r = check('func f():\n    $Hero.add("sword", 1)\n');
    expect(errors(r)).toEqual(['$Hero is a Sprite2D, which has no "add".']);
  });

  it("is an error when the script is attached to something that isn't an Inventory and uses self", () => {
    const r = check('func f():\n    add("sword", 1)\n', attachedTo("Sprite2D"));
    expect(errors(r)[0]).toMatch(/"add" isn't available on the Sprite2D \(a Sprite2D\), and this script is attached to it\./);
    // With nothing attached yet, self may be anything.
    expect(errors(check('func f():\n    add("sword", 1)\n', []))).toEqual([]);
  });

  it("is an error to name an item that isn't in the project, listing the ones it has", () => {
    expect(errors(check('func f():\n    $Bag.add("shield", 1)\n'))).toEqual(['There is no item "shield". Its items are: "sword", "potion".']);
  });

  it("says so when the project has no items yet", () => {
    expect(errors(check('func f():\n    $Bag.add("sword", 1)\n', attachedTo("Sprite2D"), []))).toEqual(["There are no items yet. Add one in the Inspector."]);
  });

  it("needs the item's name in quotes, not a variable or number", () => {
    expect(errors(check('func f():\n    var s = "sword"\n    $Bag.add(s, 1)\n'))[0]).toMatch(/add\(\) needs the item's name in quotes/);
    expect(errors(check("func f():\n    $Bag.add(1, 1)\n"))[0]).toMatch(/add\(\) needs the item's name in quotes/);
  });

  it("needs a whole number for count/slot, rejecting a float without int()", () => {
    expect(errors(check('func f():\n    $Bag.add("sword", 1.5)\n'))[0]).toMatch(/A float can't go into an int without losing its fraction/);
    expect(errors(check('func f():\n    $Bag.slot_count(1.5)\n'))[0]).toMatch(/A float can't go into an int without losing its fraction/);
  });

  it("checks the argument count", () => {
    expect(errors(check('func f():\n    $Bag.add("sword")\n'))[0]).toMatch(/add\(item, count\) takes 2 arguments, but 1 was given/);
    expect(errors(check('func f():\n    $Bag.count("sword", 1)\n'))[0]).toMatch(/count\(item\) takes 1 argument, but 2 were given/);
  });

  it("count/slot_item_is are bools or ints as appropriate: add/remove/count/slot_count/slot_icon are int, slot_item_is is bool", () => {
    expect(check('func f() -> int:\n    return $Bag.add("sword", 1)\n').ok).toBe(true);
    expect(check('func f() -> bool:\n    return $Bag.slot_item_is(0, "sword")\n').ok).toBe(true);
    expect(errors(check('func f() -> bool:\n    return $Bag.count("sword")\n')).length).toBe(1);
  });

  it("must be called, and the six names are built-in (can't be a variable or function)", () => {
    expect(errors(check("func f():\n    var x = $Bag.add\n"))[0]).toMatch(/add must be called: add\(item, count\)/);
    expect(errors(check("func f():\n    var x = $Bag.slot_count\n"))[0]).toMatch(/slot_count must be called: slot_count\(slot\)/);
    expect(errors(check("var add = 1\n"))[0]).toMatch(/"add" is a built-in name/);
    expect(errors(check("func count():\n    pass\n"))[0]).toMatch(/"count" is a built-in name/);
  });

  it("gives no cascade when the Inventory is unknown", () => {
    expect(errors(check('func f():\n    $Missing.add("sword", 1)\n'))).toEqual(['There is no node named "Missing" in the scene.']);
  });
});

describe("an Inventory's own visible, for its on-screen panel (STORY.inventory-ui-panel.md)", () => {
  it("reads and writes visible, by $Name or on self", () => {
    const r = check('func _process(delta):\n    $Bag.visible = false\n    var v = $Bag.visible\n', attachedTo("Sprite2D"));
    expect(errors(r)).toEqual([]);
    const self = check("func f():\n    visible = false\n    var v = visible\n", attachedTo("Inventory"));
    expect(errors(self)).toEqual([]);
  });

  it("doesn't offer position, rotation or scale (the panel's own v1 never reads them live)", () => {
    expect(errors(check("func f():\n    $Bag.position.x = 1.0\n"))).toEqual(['$Bag is a Inventory, which has no "position".']);
    expect(errors(check("func f():\n    $Bag.rotation = 1.0\n"))).toEqual(['$Bag is a Inventory, which has no "rotation".']);
  });
});

describe("selected_slot()/select_slot(slot) on an Inventory's own on-screen panel (STORY.inventory-ui-panel.md)", () => {
  it("accepts selected_slot() -> int and select_slot(slot), with no item argument to resolve", () => {
    const r = check('func _process(delta):\n    var s = $Bag.selected_slot()\n    $Bag.select_slot(s)\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    expect((body[0] as { kind: "var"; init: { res?: unknown } }).init.res).toMatchObject({ kind: "inventoryCall", method: "selected_slot", target: { kind: "node", name: "Bag" } });
    const selectCall = (body[1] as { kind: "expr"; expr: { res?: unknown } }).expr;
    expect(selectCall.res).toMatchObject({ kind: "inventoryCall", method: "select_slot" });
  });

  it("works on self, called plainly or with self.", () => {
    const r = check("func f():\n    var s = selected_slot()\n    self.select_slot(s)\n", attachedTo("Inventory"));
    expect(errors(r)).toEqual([]);
  });

  it("checks the argument count", () => {
    expect(errors(check("func f():\n    $Bag.selected_slot(0)\n"))[0]).toMatch(/selected_slot\(\) takes 0 arguments, but 1 was given/);
    expect(errors(check("func f():\n    $Bag.select_slot()\n"))[0]).toMatch(/select_slot\(slot\) takes 1 argument, but 0 were given/);
  });

  it("select_slot's own slot is an int, rejecting a float without int()", () => {
    expect(errors(check("func f():\n    $Bag.select_slot(1.5)\n"))[0]).toMatch(/A float can't go into an int without losing its fraction/);
  });

  it("selected_slot() gives an int, but select_slot() gives no value at all", () => {
    expect(check("func f() -> int:\n    return $Bag.selected_slot()\n").ok).toBe(true);
    expect(errors(check("func f():\n    var x = $Bag.select_slot(0)\n"))[0]).toMatch(/This call doesn't give a value\./);
  });

  it("must be called, and both names are built-in (can't be a variable or function)", () => {
    expect(errors(check("func f():\n    var x = $Bag.selected_slot\n"))[0]).toMatch(/selected_slot must be called: selected_slot\(\)/);
    expect(errors(check("func f():\n    var x = $Bag.select_slot\n"))[0]).toMatch(/select_slot must be called: select_slot\(slot\)/);
    expect(errors(check("var selected_slot = 1\n"))[0]).toMatch(/"selected_slot" is a built-in name/);
    expect(errors(check("func select_slot():\n    pass\n"))[0]).toMatch(/"select_slot" is a built-in name/);
  });

  it("is an error to name something that isn't an Inventory", () => {
    expect(errors(check("func f():\n    $Hero.selected_slot()\n"))).toEqual(['$Hero is a Sprite2D, which has no "selected_slot".']);
  });
});

describe("set_frame() on a Sprite2D or AnimatedSprite2D (STORY.inventory.md)", () => {
  it("accepts set_frame(frame) on a Sprite2D or AnimatedSprite2D", () => {
    const r = check('func _process(delta):\n    $Hero.set_frame(2)\n    $Enemy.set_frame(0)\n');
    expect(errors(r)).toEqual([]);
    const body = r.program.functions[0].body;
    expect((body[0] as { kind: "expr"; expr: { res?: unknown } }).expr.res).toMatchObject({ kind: "spriteSetFrame", target: { kind: "node", name: "Hero" } });
  });

  it("works on self, called plainly or with self.", () => {
    const r = check("func f():\n    set_frame(1)\n    self.set_frame(2)\n", attachedTo("Sprite2D"));
    expect(errors(r)).toEqual([]);
  });

  it("is an error to name something that isn't a Sprite2D/AnimatedSprite2D", () => {
    expect(errors(check("func f():\n    $Bag.set_frame(0)\n"))).toEqual(["set_frame() works on a Sprite2D or AnimatedSprite2D, but $Bag is a Inventory."]);
  });

  it("needs a whole number", () => {
    expect(errors(check('func f():\n    $Hero.set_frame("a")\n'))[0]).toMatch(/can't be used as an int|An int can't/);
  });

  it("must be called, and is a built-in name", () => {
    expect(errors(check("func f():\n    var x = $Hero.set_frame\n"))[0]).toMatch(/set_frame must be called/);
    expect(errors(check("var set_frame = 1\n"))[0]).toMatch(/"set_frame" is a built-in name/);
  });
});
