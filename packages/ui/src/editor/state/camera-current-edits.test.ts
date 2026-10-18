import { CAMERA_FAR_PLANE_DEFAULT, CAMERA_FAR_PLANE_MAX, CAMERA_FAR_PLANE_MIN, createBlankSceneTree, createProjectSnapshot, findSceneNode, getCameraFarPlane, isCurrentCamera } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.current-camera.md: marking a scene's active camera, in the editor's state. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function withTwoCameras(): { state: EditorState; first: string; second: string } {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  const opened = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
  const withFirst = run(opened, { type: "ADD_NODE", kind: "Camera3D" });
  const first = withFirst.selectedNodeId!;
  // Re-select the scene root so the second camera lands as a sibling of the first, not a child of it.
  const reselected = run(withFirst, { type: "SELECT_NODE", id: withFirst.sceneRoot.id });
  const withSecond = run(reselected, { type: "ADD_NODE", kind: "Camera3D" });
  const second = withSecond.selectedNodeId!;
  return { state: withSecond, first, second };
}
describe("a scene's current camera", () => {
  it("defaults to the first Camera3D added, and marking another current switches it, and undoes", () => {
    const { state, first, second } = withTwoCameras();
    const cams = () => [findSceneNode(state.sceneRoot, first)!, findSceneNode(state.sceneRoot, second)!];
    expect(isCurrentCamera(cams()[0], cams())).toBe(true);
    expect(isCurrentCamera(cams()[1], cams())).toBe(false);

    const switched = run(state, { type: "SET_CAMERA_CURRENT", id: second, current: true });
    const switchedCams = [findSceneNode(switched.sceneRoot, first)!, findSceneNode(switched.sceneRoot, second)!];
    expect(isCurrentCamera(switchedCams[0], switchedCams)).toBe(false);
    expect(isCurrentCamera(switchedCams[1], switchedCams)).toBe(true);

    const undone = run(switched, { type: "UNDO" });
    const undoneCams = [findSceneNode(undone.sceneRoot, first)!, findSceneNode(undone.sceneRoot, second)!];
    expect(isCurrentCamera(undoneCams[0], undoneCams)).toBe(true);
  });

  it("unmarking the explicitly current one falls back to the first in the tree", () => {
    const { state, first, second } = withTwoCameras();
    const switched = run(state, { type: "SET_CAMERA_CURRENT", id: second, current: true });
    const unmarked = run(switched, { type: "SET_CAMERA_CURRENT", id: second, current: false });
    const cams = [findSceneNode(unmarked.sceneRoot, first)!, findSceneNode(unmarked.sceneRoot, second)!];
    expect(isCurrentCamera(cams[0], cams)).toBe(true);
    expect(isCurrentCamera(cams[1], cams)).toBe(false);
    expect(findSceneNode(unmarked.sceneRoot, second)!.camera).toBeUndefined();
  });

  it("ignores setting what it already is, and a node that isn't a Camera3D", () => {
    const { state, first, second } = withTwoCameras();
    expect(run(state, { type: "SET_CAMERA_CURRENT", id: first, current: true })).toBe(state);
    expect(run(state, { type: "SET_CAMERA_CURRENT", id: second, current: false })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_CAMERA_CURRENT", id: other.selectedNodeId!, current: true })).toBe(other);
  });

  it("is saved with the project", () => {
    const { state, second } = withTwoCameras();
    const switched = run(state, { type: "SET_CAMERA_CURRENT", id: second, current: true });
    const saved = savedProjectOf(switched);
    expect(saved.scene.children.find((n) => n.id === second)!.camera?.current).toBe(true);
  });
});

describe("a Camera3D's far plane", () => {
  it("defaults to CAMERA_FAR_PLANE_DEFAULT, sets, clamps, undoes, and is saved", () => {
    const { state, first } = withTwoCameras();
    expect(getCameraFarPlane(findSceneNode(state.sceneRoot, first)!)).toBe(CAMERA_FAR_PLANE_DEFAULT);

    const far = run(state, { type: "SET_CAMERA_FAR_PLANE", id: first, farPlane: 300, at: 1000 });
    expect(getCameraFarPlane(findSceneNode(far.sceneRoot, first)!)).toBe(300);
    expect(far.history.past.at(-1)!.label).toBe("Change far plane of Camera3D");

    expect(getCameraFarPlane(findSceneNode(run(state, { type: "SET_CAMERA_FAR_PLANE", id: first, farPlane: 1, at: 0 }).sceneRoot, first)!)).toBe(CAMERA_FAR_PLANE_MIN);
    expect(getCameraFarPlane(findSceneNode(run(state, { type: "SET_CAMERA_FAR_PLANE", id: first, farPlane: 99999, at: 0 }).sceneRoot, first)!)).toBe(CAMERA_FAR_PLANE_MAX);

    const undone = run(far, { type: "UNDO" });
    expect(getCameraFarPlane(findSceneNode(undone.sceneRoot, first)!)).toBe(CAMERA_FAR_PLANE_DEFAULT);

    expect(savedProjectOf(far).scene.children.find((n) => n.id === first)!.camera?.farPlane).toBe(300);
  });

  it("does nothing when set to what it already effectively is, or for a node that isn't a Camera3D", () => {
    const { state, first } = withTwoCameras();
    expect(run(state, { type: "SET_CAMERA_FAR_PLANE", id: first, farPlane: CAMERA_FAR_PLANE_DEFAULT, at: 0 })).toBe(state);
    const other = run(state, { type: "ADD_NODE", kind: "Node3D" });
    expect(run(other, { type: "SET_CAMERA_FAR_PLANE", id: other.selectedNodeId!, farPlane: 300, at: 0 })).toBe(other);
  });

  it("survives marking/unmarking the camera current, and vice versa -- neither edit clobbers the other's own field", () => {
    const { state, first, second } = withTwoCameras();
    const farSet = run(state, { type: "SET_CAMERA_FAR_PLANE", id: first, farPlane: 300, at: 0 });
    const alsoCurrent = run(farSet, { type: "SET_CAMERA_CURRENT", id: first, current: true });
    expect(getCameraFarPlane(findSceneNode(alsoCurrent.sceneRoot, first)!)).toBe(300);
    expect(isCurrentCamera(findSceneNode(alsoCurrent.sceneRoot, first)!, [findSceneNode(alsoCurrent.sceneRoot, first)!, findSceneNode(alsoCurrent.sceneRoot, second)!])).toBe(true);
    const unmarked = run(alsoCurrent, { type: "SET_CAMERA_CURRENT", id: first, current: false });
    expect(getCameraFarPlane(findSceneNode(unmarked.sceneRoot, first)!)).toBe(300);

    // And the other way: marking a *different* camera current, which unmarks this one, keeps this one's own far plane.
    const switched = run(farSet, { type: "SET_CAMERA_CURRENT", id: second, current: true });
    const switchedBack = run(switched, { type: "SET_CAMERA_CURRENT", id: first, current: true });
    expect(getCameraFarPlane(findSceneNode(switchedBack.sceneRoot, second)!)).toBe(CAMERA_FAR_PLANE_DEFAULT);
    expect(getCameraFarPlane(findSceneNode(switchedBack.sceneRoot, first)!)).toBe(300);
  });
});
