import { createBlankSceneTree, createProjectSnapshot, DEFAULT_SKY_BOX, findSceneNode, getSkyBox, isCurrentSkyBox, withUpdatedScene } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
const withSkyBox = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "SkyBox3D" });
  return { state, id: state.selectedNodeId };
};
const set = (id: string, change: Partial<{ topColor: string; horizonColor: string; distance: number }>, at: number): Action => ({ type: "SET_SKY_BOX", id, change, at });
const skyOf = (s: EditorState, id: string) => getSkyBox(findSceneNode(s.sceneRoot, id)!);

describe("a new sky box", () => {
  it("starts at the default colors with nothing saved for it", () => {
    const { state, id } = withSkyBox();
    expect(skyOf(state, id)).toEqual(DEFAULT_SKY_BOX);
    expect(findSceneNode(state.sceneRoot, id)!.skyBox).toBeUndefined();
  });
});

describe("sky box color edits", () => {
  it("sets one color at a time, leaving the other alone and the distance at its default, and undoes and redoes it", () => {
    const { state, id } = withSkyBox();
    const topChanged = run(state, set(id, { topColor: "#ff0000" }, 1000));
    expect(skyOf(topChanged, id)).toEqual({ topColor: "#ff0000", horizonColor: DEFAULT_SKY_BOX.horizonColor, distance: DEFAULT_SKY_BOX.distance });
    expect(hasUnsavedChanges(topChanged)).toBe(true);
    const bothChanged = run(topChanged, { type: "END_EDIT_GESTURE" }, set(id, { horizonColor: "#0000ff" }, 2000));
    expect(skyOf(bothChanged, id)).toEqual({ topColor: "#ff0000", horizonColor: "#0000ff", distance: DEFAULT_SKY_BOX.distance });
    const undone = run(bothChanged, { type: "UNDO" });
    expect(skyOf(undone, id)).toEqual({ topColor: "#ff0000", horizonColor: DEFAULT_SKY_BOX.horizonColor, distance: DEFAULT_SKY_BOX.distance });
    expect(skyOf(run(undone, { type: "REDO" }), id)).toEqual({ topColor: "#ff0000", horizonColor: "#0000ff", distance: DEFAULT_SKY_BOX.distance });
    expect(bothChanged.history.past.at(-1)!.label).toBe("Change horizon color of SkyBox3D");
  });

  it("sets the distance, clamped to 0.5..7.5, as its own undo step", () => {
    const { state, id } = withSkyBox();
    const moved = run(state, set(id, { distance: 3 }, 1000));
    expect(skyOf(moved, id).distance).toBe(3);
    expect(moved.history.past.at(-1)!.label).toBe("Change distance of SkyBox3D");
    expect(skyOf(run(state, set(id, { distance: 100 }, 0)), id).distance).toBe(7.5);
    expect(skyOf(run(state, set(id, { distance: -5 }, 0)), id).distance).toBe(0.5);
    const undone = run(moved, { type: "UNDO" });
    expect(skyOf(undone, id).distance).toBe(DEFAULT_SKY_BOX.distance);
  });

  it("does nothing when the color or distance is what it already has, including the defaults on a sky box that never had any saved", () => {
    const { state, id } = withSkyBox();
    expect(run(state, set(id, { topColor: DEFAULT_SKY_BOX.topColor }, 0))).toBe(state);
    expect(run(state, set(id, { distance: DEFAULT_SKY_BOX.distance }, 0))).toBe(state);
    const changed = run(state, set(id, { topColor: "#ff0000" }, 0));
    expect(run(changed, set(id, { topColor: "#ff0000" }, 5000))).toBe(changed);
  });

  it("does nothing for a node that isn't a sky box", () => {
    const s = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
    expect(run(s, set(s.selectedNodeId, { topColor: "#ff0000" }, 0))).toBe(s);
    expect(run(s, set("nope", { topColor: "#ff0000" }, 0))).toBe(s);
  });

  it("is saved with the node", () => {
    const { state, id } = withSkyBox();
    const changed = run(state, set(id, { topColor: "#ff0000", horizonColor: "#0000ff", distance: 2 }, 0));
    expect(findSceneNode(withUpdatedScene(changed.project!, changed.sceneRoot).scene, id)!.skyBox).toEqual({ topColor: "#ff0000", horizonColor: "#0000ff", distance: 2 });
  });
});

/** requirements/scene-designer/STORY.sky-box.md: a scene's own default sky box, for a day/night (or similar) cycle built from more than one. */
describe("a scene's default sky box", () => {
  function withTwoSkyBoxes(): { state: EditorState; first: string; second: string } {
    const withFirst = run(openProject(), { type: "ADD_NODE", kind: "SkyBox3D" });
    const first = withFirst.selectedNodeId!;
    const reselected = run(withFirst, { type: "SELECT_NODE", id: withFirst.sceneRoot.id });
    const withSecond = run(reselected, { type: "ADD_NODE", kind: "SkyBox3D" });
    const second = withSecond.selectedNodeId!;
    return { state: withSecond, first, second };
  }

  it("defaults to the first SkyBox3D added, and marking another current switches it, and undoes", () => {
    const { state, first, second } = withTwoSkyBoxes();
    const skiesOf = (s: EditorState) => [findSceneNode(s.sceneRoot, first)!, findSceneNode(s.sceneRoot, second)!];
    expect(isCurrentSkyBox(skiesOf(state)[0], skiesOf(state))).toBe(true);
    expect(isCurrentSkyBox(skiesOf(state)[1], skiesOf(state))).toBe(false);

    const switched = run(state, { type: "SET_SKY_BOX_CURRENT", id: second, current: true });
    expect(isCurrentSkyBox(skiesOf(switched)[0], skiesOf(switched))).toBe(false);
    expect(isCurrentSkyBox(skiesOf(switched)[1], skiesOf(switched))).toBe(true);
    expect(switched.history.past.at(-1)!.label).toBe("Make SkyBox3D2 the default sky box"); // the second one added, named uniquely

    const undone = run(switched, { type: "UNDO" });
    expect(isCurrentSkyBox(skiesOf(undone)[0], skiesOf(undone))).toBe(true);
  });

  it("unmarking the explicitly current one falls back to the first in the tree", () => {
    const { state, first, second } = withTwoSkyBoxes();
    const switched = run(state, { type: "SET_SKY_BOX_CURRENT", id: second, current: true });
    const unmarked = run(switched, { type: "SET_SKY_BOX_CURRENT", id: second, current: false });
    const skies = [findSceneNode(unmarked.sceneRoot, first)!, findSceneNode(unmarked.sceneRoot, second)!];
    expect(isCurrentSkyBox(skies[0], skies)).toBe(true);
    expect(isCurrentSkyBox(skies[1], skies)).toBe(false);
    expect(findSceneNode(unmarked.sceneRoot, second)!.skyBox).toBeUndefined();
  });

  it("ignores setting what it already is, and a node that isn't a SkyBox3D", () => {
    const { state, first, second } = withTwoSkyBoxes();
    expect(run(state, { type: "SET_SKY_BOX_CURRENT", id: first, current: true })).toBe(state);
    expect(run(state, { type: "SET_SKY_BOX_CURRENT", id: second, current: false })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_SKY_BOX_CURRENT", id: other.selectedNodeId!, current: true })).toBe(other);
  });

  it("marking current and changing colors never clobber each other's own field, either order", () => {
    // A second sky box (first is already "current" by isCurrentSkyBox's own fallback -- marking it again would be a
    // no-op, see the "ignores setting what it already is" test above -- so this uses the second one instead, where
    // marking it current is a real edit).
    const { state, second } = withTwoSkyBoxes();
    const id = second;
    const coloredThenCurrent = run(state, set(id, { topColor: "#ff0000" }, 0), { type: "SET_SKY_BOX_CURRENT", id, current: true });
    expect(skyOf(coloredThenCurrent, id).topColor).toBe("#ff0000");
    expect(findSceneNode(coloredThenCurrent.sceneRoot, id)!.skyBox?.current).toBe(true);

    const currentThenColored = run(state, { type: "SET_SKY_BOX_CURRENT", id, current: true }, set(id, { topColor: "#00ff00" }, 0));
    expect(skyOf(currentThenColored, id).topColor).toBe("#00ff00");
    expect(findSceneNode(currentThenColored.sceneRoot, id)!.skyBox?.current).toBe(true);
  });

  it("is saved with the project", () => {
    const { state, second } = withTwoSkyBoxes();
    const switched = run(state, { type: "SET_SKY_BOX_CURRENT", id: second, current: true });
    const saved = withUpdatedScene(switched.project!, switched.sceneRoot);
    expect(findSceneNode(saved.scene, second)!.skyBox?.current).toBe(true);
  });
});
