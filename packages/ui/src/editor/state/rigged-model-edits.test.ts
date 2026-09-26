import { buildArm, createBlankSceneTree, createProjectSnapshot, findSceneNode, flattenSceneTree, importGltf, type RiggedModel } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, savedProjectOf, type Action, type EditorState } from "./editor-store";

/** requirements/scene-designer/STORY.rigged-models.md: putting an imported rigged model in the scene. */

const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(editorReducer, state);
function model(): RiggedModel {
  const built = buildArm({ animation: true });
  const r = importGltf({ json: built.json, buffers: [built.bin] }, "Robot");
  if (!r.ok) throw new Error("should import");
  return r.model;
}
function open3D(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}

describe("importing a rigged model into the scene", () => {
  it("adds the bone tree under the selected node, its models to the project, and selects the model's root", () => {
    const m = model();
    const s = run(open3D(), { type: "IMPORT_RIGGED_MODEL", model: m, warnings: ["careful"] });
    expect(findSceneNode(s.sceneRoot, s.selectedNodeId)!.name).toBe("Robot");
    expect(s.project!.meshes).toHaveLength(2);
    expect(flattenSceneTree(s.sceneRoot).filter((n) => n.kind === "MeshInstance3D" && n.name.endsWith("_mesh"))).toHaveLength(2);
    expect(s.outputLog.some((l) => /2 bones, 4 triangles, animations: "bend"/.test(l))).toBe(true);
    expect(s.outputLog).toContain("Warning: careful");
    expect(hasUnsavedChanges(s)).toBe(true);
  });

  it("is one undo step, and gives a second import its own name", () => {
    const first = run(open3D(), { type: "IMPORT_RIGGED_MODEL", model: model(), warnings: [] });
    const second = run(first, { type: "SELECT_NODE", id: first.sceneRoot.id }, { type: "IMPORT_RIGGED_MODEL", model: model(), warnings: [] });
    expect(second.sceneRoot.children.map((n) => n.name)).toEqual(["Robot", "Robot2"]);
    const undone = run(second, { type: "UNDO" });
    expect(undone.sceneRoot.children.map((n) => n.name)).toEqual(["Robot"]);
    expect(undone.project!.meshes).toHaveLength(2);
  });

  it("does nothing in a 2D project", () => {
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createBlankSceneTree("2D") });
    const s = editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
    expect(run(s, { type: "IMPORT_RIGGED_MODEL", model: model(), warnings: [] })).toBe(s);
  });

  it("is saved with the project and its animation refers to the bone by id", () => {
    const s = run(open3D(), { type: "IMPORT_RIGGED_MODEL", model: model(), warnings: [] });
    const saved = savedProjectOf(s);
    const nodes = flattenSceneTree(saved.scene);
    const arm = nodes.find((n) => n.name === "Arm")!;
    const player = nodes.find((n) => n.kind === "AnimationPlayer")!;
    expect(player.animation!.animations![0].tracks[0].nodeId).toBe(arm.id);
  });
});
