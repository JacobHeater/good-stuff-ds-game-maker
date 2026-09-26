import { describe, expect, it } from "vitest";

import { resolveShortcut, type ShortcutContext, type ShortcutKey, type ShortcutCommand } from "./keyboard-shortcuts";

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  projectOpen: true,
  promptOpen: false,
  workspace: "2D",
  workspaces: ["2D", "Script", "Game"],
  selectedIsRoot: false,
  selectedHasPosition2D: true,
  focus: "none",
  ...overrides
});
const key = (k: string, modifiers: Partial<ShortcutKey> = {}): ShortcutKey => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...modifiers });
const ctrl = (k: string, modifiers: Partial<ShortcutKey> = {}): ShortcutKey => key(k, { ctrlKey: true, ...modifiers });
const resolve = (event: ShortcutKey, overrides: Partial<ShortcutContext> = {}): ShortcutCommand | null => resolveShortcut(event, context(overrides));

describe("keyboard shortcuts", () => {
  it("maps each chord to its command", () => {
    expect(resolve(ctrl("z"))).toEqual({ type: "undo" });
    expect(resolve(ctrl("z", { shiftKey: true }))).toEqual({ type: "redo" });
    expect(resolve(ctrl("Z", { shiftKey: true }))).toEqual({ type: "redo" }); // Shift makes the browser report a capital
    expect(resolve(ctrl("y"))).toEqual({ type: "redo" });
    expect(resolve(ctrl("s"))).toEqual({ type: "save" });
    expect(resolve(ctrl("S", { shiftKey: true }))).toEqual({ type: "save-as" });
    expect(resolve(ctrl("o"))).toEqual({ type: "open" });
    expect(resolve(ctrl("E", { shiftKey: true }))).toEqual({ type: "export-rom" });
    expect(resolve(ctrl("d"))).toEqual({ type: "duplicate" });
    expect(resolve(key("Delete"))).toEqual({ type: "delete" });
    expect(resolve(key("Backspace"))).toEqual({ type: "delete" });
    expect(resolve(key("F5"))).toEqual({ type: "play" });
    expect(resolve(key("F2"))).toEqual({ type: "rename" });
    expect(resolve(key("Escape"))).toEqual({ type: "select-root" });
    expect(resolve(ctrl("1"))).toEqual({ type: "workspace", workspace: "2D" });
    expect(resolve(ctrl("2"))).toEqual({ type: "workspace", workspace: "Script" });
    expect(resolve(ctrl("3"))).toEqual({ type: "workspace", workspace: "Game" });
  });

  it("treats Cmd like Ctrl", () => {
    expect(resolve(key("d", { metaKey: true }))).toEqual({ type: "duplicate" });
    expect(resolve(key("s", { metaKey: true }))).toEqual({ type: "save" });
  });

  it("does nothing with no project open or while the unsaved-changes prompt is up", () => {
    for (const overrides of [{ projectOpen: false }, { promptOpen: true }]) {
      for (const event of [ctrl("z"), ctrl("s"), ctrl("d"), key("Delete"), key("F5"), key("ArrowLeft")]) expect(resolve(event, overrides)).toBeNull();
    }
  });

  it("nudges a selected 2D node by 1 pixel, or 8 with Shift", () => {
    expect(resolve(key("ArrowLeft"))).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(resolve(key("ArrowRight"))).toEqual({ type: "nudge", dx: 1, dy: 0 });
    expect(resolve(key("ArrowUp"))).toEqual({ type: "nudge", dx: 0, dy: -1 });
    expect(resolve(key("ArrowDown", { shiftKey: true }))).toEqual({ type: "nudge", dx: 0, dy: 8 });
    expect(resolve(key("ArrowRight", { repeat: true }))).toEqual({ type: "nudge", dx: 1, dy: 0 }); // holding the key keeps moving
  });

  it("leaves arrows alone for a node with no 2D position (a 3D node, a player) and with Ctrl or Alt held", () => {
    expect(resolve(key("ArrowLeft"), { selectedHasPosition2D: false })).toBeNull();
    expect(resolve(ctrl("ArrowLeft"))).toBeNull();
    expect(resolve(key("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("keeps typing keys for a text field or the code editor", () => {
    for (const focus of ["field", "code"] as const) {
      expect(resolve(key("Delete"), { focus })).toBeNull();
      expect(resolve(key("Backspace"), { focus })).toBeNull();
      expect(resolve(key("ArrowLeft"), { focus })).toBeNull();
      expect(resolve(key("Escape"), { focus })).toBeNull();
      expect(resolve(ctrl("d"), { focus })).toBeNull();
    }
  });

  it("still saves, opens, exports, plays and undoes from a text field, but the code editor keeps its own undo", () => {
    expect(resolve(ctrl("s"), { focus: "field" })).toEqual({ type: "save" });
    expect(resolve(ctrl("s"), { focus: "code" })).toEqual({ type: "save" });
    expect(resolve(key("F5"), { focus: "code" })).toEqual({ type: "play" });
    expect(resolve(ctrl("z"), { focus: "field" })).toEqual({ type: "undo" });
    expect(resolve(ctrl("z"), { focus: "code" })).toBeNull();
    expect(resolve(ctrl("y"), { focus: "code" })).toBeNull();
    expect(resolve(key("F2"), { focus: "field" })).toEqual({ type: "rename" });
  });

  it("only edits the selection on the scene's own workspaces, and never the scene root", () => {
    for (const workspace of ["Script", "Game"] as const) {
      expect(resolve(key("Delete"), { workspace })).toBeNull();
      expect(resolve(ctrl("d"), { workspace })).toBeNull();
      expect(resolve(key("ArrowLeft"), { workspace })).toBeNull();
      expect(resolve(key("F2"), { workspace })).toBeNull();
      expect(resolve(ctrl("s"), { workspace })).toEqual({ type: "save" }); // project-wide commands work anywhere
    }
    expect(resolve(key("Delete"), { workspace: "3D" })).toEqual({ type: "delete" });
    expect(resolve(key("Delete"), { selectedIsRoot: true })).toBeNull();
    expect(resolve(ctrl("d"), { selectedIsRoot: true })).toBeNull();
    expect(resolve(key("Escape"), { selectedIsRoot: true })).toBeNull(); // already there
  });

  it("ignores the wrong modifiers: Shift+Delete, Ctrl+Backspace, Alt chords, Shift+F5, a held Delete", () => {
    expect(resolve(key("Delete", { shiftKey: true }))).toBeNull();
    expect(resolve(ctrl("Backspace"))).toBeNull();
    expect(resolve(key("Delete", { repeat: true }))).toBeNull();
    expect(resolve(key("F5", { shiftKey: true }))).toBeNull();
    expect(resolve(ctrl("s", { altKey: true }))).toBeNull();
    expect(resolve(ctrl("d", { shiftKey: true }))).toBeNull();
    expect(resolve(ctrl("o", { shiftKey: true }))).toBeNull();
    expect(resolve(ctrl("e"))).toBeNull(); // export needs Shift
    expect(resolve(ctrl("x"))).toBeNull();
  });

  it("numbers the workspaces by the project's tabs, and ignores a number with no tab", () => {
    expect(resolve(ctrl("1"), { workspaces: ["3D", "Script", "Game"] })).toEqual({ type: "workspace", workspace: "3D" });
    expect(resolve(ctrl("3"), { workspaces: ["3D", "Script"] })).toBeNull();
    expect(resolve(ctrl("4"))).toBeNull();
  });
});
