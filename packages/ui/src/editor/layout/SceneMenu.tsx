import { getNodeKindsForMode, instanceWouldCycle, isTwoDVisualKind, listScenes, withSceneTree } from "@goodstuff/core";

import { NodeIcon } from "../NodeIcon";
import { selectedNodeIdsOf, useEditorStore } from "../state/editor-store";
import { MenuDropdown, MenuItem, MenuSectionLabel, MenuSeparator } from "./menu-primitives";

/**
 * The "Scene" menu: edits to what's *inside* the open scene — adding,
 * duplicating and deleting nodes. Everything about the project file itself
 * (open, save, close) lives in `ProjectMenu`; see
 * `requirements/project-menu/EPIC.project-menu.md` for the ownership rule.
 */
export function SceneMenu(): JSX.Element {
  const { state, addNode, importModel, importRiggedModel, importSound, importSprite, undo, redo, undoLabel, redoLabel, duplicateSelected, deleteSelected, instantiateScene } = useEditorStore();
  const otherScenes = state.project ? listScenes(withSceneTree(state.project, state.activeSceneId, state.sceneRoot)).filter((scene) => scene.id !== state.activeSceneId) : [];
  // Duplicate and Delete act on every selected node; the scene root can be selected but is never duplicated or deleted.
  const hasSelection = selectedNodeIdsOf(state).some((id) => id !== state.sceneRoot.id);
  const mode = state.project?.mode;

  return (
    <MenuDropdown label="Scene">
      {(run) => (
        <>
          <MenuItem label={undoLabel ? `Undo ${undoLabel}` : "Undo"} shortcut="Ctrl+Z" disabled={!undoLabel} onSelect={run(undo)} />
          <MenuItem label={redoLabel ? `Redo ${redoLabel}` : "Redo"} shortcut="Ctrl+Shift+Z" disabled={!redoLabel} onSelect={run(redo)} />
          <MenuSeparator />
          {mode && (
            <>
              <MenuSectionLabel label={`Add ${mode} Node`} />
              {getNodeKindsForMode(mode).filter((kind) => mode === "2D" || !isTwoDVisualKind(kind)).map((kind) => (
                <MenuItem key={kind} label={kind} icon={<NodeIcon kind={kind} />} onSelect={run(() => addNode(kind))} />
              ))}
              {mode === "3D" && <MenuItem label="Import Model (.obj)..." onSelect={run(() => void importModel())} />}
              {mode === "3D" && <MenuItem label="Import Animated Model (several .obj)..." onSelect={run(() => void importModel(true))} />}
              {mode === "3D" && <MenuItem label="Import Rigged Model (.glb / .gltf)..." onSelect={run(() => void importRiggedModel())} />}
              {mode === "3D" && (
                <>
                  <MenuSeparator />
                  <MenuSectionLabel label="Add 2D Node (the 2D screen)" />
                  {getNodeKindsForMode(mode).filter(isTwoDVisualKind).map((kind) => (
                    <MenuItem key={kind} label={kind} icon={<NodeIcon kind={kind} />} onSelect={run(() => addNode(kind))} />
                  ))}
                </>
              )}
              <MenuItem label="Import Sound..." onSelect={run(() => void importSound(null))} />
              <MenuItem label="Import Sprite Image..." onSelect={run(() => void importSprite(null))} />
              <MenuSeparator />
            </>
          )}
          {otherScenes.length > 0 && (
            <>
              <MenuSectionLabel label="Instantiate Scene (a scene inside this one)" />
              {otherScenes.map((scene) => (
                <MenuItem
                  key={scene.id}
                  label={scene.name}
                  disabled={state.project ? instanceWouldCycle(withSceneTree(state.project, state.activeSceneId, state.sceneRoot), state.activeSceneId, scene.id) : true}
                  onSelect={run(() => instantiateScene(scene.id))}
                />
              ))}
              <MenuSeparator />
            </>
          )}
          <MenuItem
            label="Duplicate Node"
            shortcut="Ctrl+D"
            disabled={!hasSelection}
            onSelect={run(duplicateSelected)}
          />
          <MenuItem
            label="Delete Node"
            shortcut="Del"
            disabled={!hasSelection}
            onSelect={run(deleteSelected)}
          />
        </>
      )}
    </MenuDropdown>
  );
}
