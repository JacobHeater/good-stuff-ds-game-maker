import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { EMPTY_HISTORY, endGesture, MAX_HISTORY, MERGE_WINDOW_MS, recordEdit, redoStep, undoStep, type EditState } from "./edit-history";

const state = (name: string): EditState => ({ sceneRoot: createSceneNode({ name, kind: "Node3D" }) as SceneNode, meshes: undefined, textures: undefined, sounds: undefined, scripts: undefined, selectedNodeId: name });

describe("edit history", () => {
  it("records an edit and undoes it, keeping the current state for redo", () => {
    const a = state("a");
    const b = state("b");
    const h = recordEdit(EMPTY_HISTORY, a, { label: "Add node" });
    const undone = undoStep(h, b)!;
    expect(undone.entry.sceneRoot).toBe(a.sceneRoot); // the same object, not a copy
    expect(undone.entry.label).toBe("Add node");
    expect(undone.history.past).toEqual([]);
    expect(undone.history.future).toHaveLength(1);
    const redone = redoStep(undone.history, a)!;
    expect(redone.entry.sceneRoot).toBe(b.sceneRoot);
    expect(redone.history.past).toHaveLength(1);
    expect(redone.history.future).toEqual([]);
  });

  it("has nothing to undo or redo when empty", () => {
    expect(undoStep(EMPTY_HISTORY, state("a"))).toBeNull();
    expect(redoStep(EMPTY_HISTORY, state("a"))).toBeNull();
  });

  it("clears the redo stack on a new edit", () => {
    const h1 = recordEdit(EMPTY_HISTORY, state("a"), { label: "one" });
    const undone = undoStep(h1, state("b"))!.history;
    expect(undone.future).toHaveLength(1);
    expect(recordEdit(undone, state("c"), { label: "two" }).future).toEqual([]);
  });

  it("merges edits with the same key that arrive close together, and slides the window", () => {
    let h = recordEdit(EMPTY_HISTORY, state("a"), { label: "Move", mergeKey: "k", at: 0 });
    for (let t = 400; t <= 4000; t += 400) h = recordEdit(h, state(`t${t}`), { label: "Move", mergeKey: "k", at: t });
    expect(h.past).toHaveLength(1); // ten updates over four seconds, each within a second of the last
    expect(h.past[0].sceneRoot.name).toBe("a"); // and it remembers the state before the first
  });

  it("starts a new step after a pause, for a different key, or for an edit with no key", () => {
    const base = recordEdit(EMPTY_HISTORY, state("a"), { label: "Move", mergeKey: "k", at: 0 });
    expect(recordEdit(base, state("b"), { label: "Move", mergeKey: "k", at: MERGE_WINDOW_MS }).past).toHaveLength(2);
    expect(recordEdit(base, state("b"), { label: "Rotate", mergeKey: "other", at: 10 }).past).toHaveLength(2);
    expect(recordEdit(base, state("b"), { label: "Delete" }).past).toHaveLength(2);
  });

  it("ends a gesture explicitly, so two quick drags are two steps", () => {
    let h = recordEdit(EMPTY_HISTORY, state("a"), { label: "Move", mergeKey: "k", at: 0 });
    h = recordEdit(h, state("b"), { label: "Move", mergeKey: "k", at: 50 });
    expect(h.past).toHaveLength(1);
    h = endGesture(h);
    h = recordEdit(h, state("c"), { label: "Move", mergeKey: "k", at: 100 });
    expect(h.past).toHaveLength(2);
    expect(endGesture(EMPTY_HISTORY)).toBe(EMPTY_HISTORY); // nothing to end: no new object
  });

  it("doesn't merge across an undo", () => {
    let h = recordEdit(EMPTY_HISTORY, state("a"), { label: "Move", mergeKey: "k", at: 0 });
    h = undoStep(h, state("b"))!.history;
    h = redoStep(h, state("a"))!.history;
    h = recordEdit(h, state("c"), { label: "Move", mergeKey: "k", at: 10 });
    expect(h.past).toHaveLength(2);
  });

  it(`keeps only the last ${MAX_HISTORY} steps`, () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 25; i++) h = recordEdit(h, state(`s${i}`), { label: `edit ${i}` });
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.past[0].label).toBe("edit 25");
    expect(h.past.at(-1)!.label).toBe(`edit ${MAX_HISTORY + 24}`);
  });

  it("undoes several steps in reverse order", () => {
    let h = EMPTY_HISTORY;
    for (const n of ["one", "two", "three"]) h = recordEdit(h, state(n), { label: n });
    const labels: string[] = [];
    const current = state("now");
    for (let step = undoStep(h, current); step; step = undoStep(step.history, step.entry)) labels.push(step.entry.label);
    expect(labels).toEqual(["three", "two", "one"]);
  });
});
