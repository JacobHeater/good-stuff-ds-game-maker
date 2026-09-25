import {
  createBlankSceneTree,
  createProjectSnapshot,
  createTextureFromRgba,
  findSceneNode,
  parseObj,
  withUpdatedScene,
  type ImportedMesh,
  type ImportedTexture
} from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { createInitialState, editorReducer, hasUnsavedChanges, type Action, type EditorState } from "./editor-store";

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(editorReducer, state);
}
function openProject(): EditorState {
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createBlankSceneTree("3D") });
  return editorReducer(createInitialState(), { type: "PROJECT_OPENED", filePath: "p.gsds", project });
}
function texture(id: string, name = id): ImportedTexture {
  const made = createTextureFromRgba(new Uint8Array(8 * 8 * 4).fill(200), 8, 8, { name });
  if (!made.ok) throw new Error("texture didn't convert");
  return { id, ...made.texture };
}
const quadWithUvs: ImportedMesh = (() => {
  const parsed = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n", { name: "quad" });
  if (!parsed.ok) throw new Error("fixture didn't parse");
  return { id: "quad", ...parsed.mesh };
})();
const bareTriangle: ImportedMesh = (() => {
  const parsed = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", { name: "bare" });
  if (!parsed.ok) throw new Error("fixture didn't parse");
  return { id: "bare", ...parsed.mesh };
})();

const withMesh = (): { state: EditorState; id: string } => {
  const state = run(openProject(), { type: "ADD_NODE", kind: "MeshInstance3D" });
  return { state, id: state.selectedNodeId };
};
const textureOf = (s: EditorState, id: string): string | undefined => findSceneNode(s.sceneRoot, id)!.mesh!.textureId;
const undo: Action = { type: "UNDO" };
const redo: Action = { type: "REDO" };

describe("importing and choosing textures", () => {
  it("imports a texture into the project and onto the mesh in one step", () => {
    const { state, id } = withMesh();
    const t = texture("t1", "bricks");
    const imported = run(state, { type: "IMPORT_TEXTURE", nodeId: id, texture: t, warnings: ["careful"] });
    expect(imported.project!.textures).toEqual([t]);
    expect(textureOf(imported, id)).toBe("t1");
    expect(imported.outputLog.slice(-2)).toEqual([
      'Imported texture "bricks" (8 x 8, 128 bytes of texture memory) onto "MeshInstance3D".',
      "Warning: careful"
    ]);
    expect(hasUnsavedChanges(imported)).toBe(true);
  });

  it("can be undone and redone, taking the texture out of the project and back", () => {
    const { state, id } = withMesh();
    const imported = run(state, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] });
    const undone = run(imported, undo);
    expect(textureOf(undone, id)).toBeUndefined();
    expect("textures" in undone.project!).toBe(false); // no leftover key, so saving writes an identical file
    expect(undone.sceneRoot).toBe(state.sceneRoot);
    const redone = run(undone, redo);
    expect(redone.project!.textures).toHaveLength(1);
    expect(textureOf(redone, id)).toBe("t1");
    expect(imported.outputLog.at(-1)).toMatch(/Imported texture/);
    expect(run(imported, undo).outputLog.at(-1)).toBe("Undid: Import texture t1.");
  });

  it("chooses a project texture for a mesh, clears it, and undoes each", () => {
    const { state, id } = withMesh();
    let s = run(state, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("a"), warnings: [] }, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("b"), warnings: [] });
    expect(textureOf(s, id)).toBe("b");
    s = run(s, { type: "SET_MESH_TEXTURE", id, textureId: "a" });
    expect(textureOf(s, id)).toBe("a");
    s = run(s, { type: "SET_MESH_TEXTURE", id, textureId: null });
    expect(textureOf(s, id)).toBeUndefined();
    expect("textureId" in findSceneNode(s.sceneRoot, id)!.mesh!).toBe(false);
    expect(textureOf(run(s, undo), id)).toBe("a");
    expect(textureOf(run(s, undo, undo), id)).toBe("b");
  });

  it("does nothing for a texture the project lacks, a mesh that isn't one, or the value it already has", () => {
    const { state, id } = withMesh();
    expect(run(state, { type: "SET_MESH_TEXTURE", id, textureId: "nope" })).toBe(state);
    expect(run(state, { type: "SET_MESH_TEXTURE", id, textureId: null })).toBe(state); // already none
    expect(run(state, { type: "SET_MESH_TEXTURE", id: state.sceneRoot.id, textureId: null })).toBe(state); // the scene root isn't a mesh
    const textured = run(state, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] });
    expect(run(textured, { type: "SET_MESH_TEXTURE", id, textureId: "t1" })).toBe(textured);
    expect(run(state, { type: "IMPORT_TEXTURE", nodeId: state.sceneRoot.id, texture: texture("t2"), warnings: [] })).toBe(state);
  });

  it("won't texture a mesh whose model has no texture coordinates, and clears the texture when a mesh switches to such a model", () => {
    const { state, id } = withMesh();
    const withModels: EditorState = { ...state, project: { ...state.project!, meshes: [quadWithUvs, bareTriangle] } };
    const onBare = run(withModels, { type: "SET_MESH_SOURCE", id, source: { importedMeshId: "bare" } });
    expect(run(onBare, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] })).toBe(onBare);
    expect(run({ ...onBare, project: { ...onBare.project!, textures: [texture("t1")] } }, { type: "SET_MESH_TEXTURE", id, textureId: "t1" }).history).toEqual(onBare.history);

    // A textured cube, switched to a model without UVs, loses its texture; switching to one with UVs keeps it. One undo brings it back.
    const textured = run(withModels, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] });
    const toBare = run(textured, { type: "SET_MESH_SOURCE", id, source: { importedMeshId: "bare" } });
    expect(textureOf(toBare, id)).toBeUndefined();
    const toQuad = run(textured, { type: "SET_MESH_SOURCE", id, source: { importedMeshId: "quad" } });
    expect(textureOf(toQuad, id)).toBe("t1");
    expect(textureOf(run(toBare, undo), id)).toBe("t1");
  });

  it("drops an unused texture when the project is saved, and keeps a used one", () => {
    const { state, id } = withMesh();
    const textured = run(state, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] });
    expect(withUpdatedScene(textured.project!, textured.sceneRoot).textures).toHaveLength(1);
    const cleared = run(textured, { type: "SET_MESH_TEXTURE", id, textureId: null });
    expect("textures" in withUpdatedScene(cleared.project!, cleared.sceneRoot)).toBe(false);
  });

  it("makes a texture import undoable to the saved state: clean again after undo", () => {
    const { state, id } = withMesh();
    const saved = editorReducer(state, { type: "PROJECT_SAVED", filePath: "p.gsds", project: withUpdatedScene(state.project!, state.sceneRoot) });
    expect(hasUnsavedChanges(saved)).toBe(false);
    const imported = run(saved, { type: "IMPORT_TEXTURE", nodeId: id, texture: texture("t1"), warnings: [] });
    expect(hasUnsavedChanges(imported)).toBe(true);
    expect(hasUnsavedChanges(run(imported, undo))).toBe(false);
  });
});
