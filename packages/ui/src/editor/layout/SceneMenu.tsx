import { getNodeKindsForMode, isTwoDVisualKind } from "@goodstuff/core";

import { NODE_KIND_ICON } from "../node-icons";
import { useEditorStore } from "../state/editor-store";
import { MenuDropdown, MenuItem, MenuSectionLabel, MenuSeparator } from "./menu-primitives";

/**
 * The "Scene" menu: edits to what's *inside* the open scene — adding,
 * duplicating and deleting nodes. Everything about the project file itself
 * (open, save, close) lives in `ProjectMenu`; see
 * `requirements/project-menu/EPIC.project-menu.md` for the ownership rule.
 */
export function SceneMenu(): JSX.Element {
  const { state, addNode, deleteNode, duplicateNode, importModel, importSound, undo, redo, undoLabel, redoLabel } = useEditorStore();
  const hasSelection = state.selectedNodeId !== state.sceneRoot.id;
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
                <MenuItem key={kind} label={kind} icon={NODE_KIND_ICON[kind]} onSelect={run(() => addNode(kind))} />
              ))}
              {mode === "3D" && <MenuItem label="Import Model (.obj)..." onSelect={run(() => void importModel())} />}
              {mode === "3D" && (
                <>
                  <MenuSeparator />
                  <MenuSectionLabel label="Add 2D Node (the 2D screen)" />
                  {getNodeKindsForMode(mode).filter(isTwoDVisualKind).map((kind) => (
                    <MenuItem key={kind} label={kind} icon={NODE_KIND_ICON[kind]} onSelect={run(() => addNode(kind))} />
                  ))}
                </>
              )}
              <MenuItem label="Import Sound..." onSelect={run(() => void importSound(null))} />
              <MenuSeparator />
            </>
          )}
          <MenuItem
            label="Duplicate Node"
            disabled={!hasSelection}
            onSelect={run(() => duplicateNode(state.selectedNodeId))}
          />
          <MenuItem
            label="Delete Node"
            disabled={!hasSelection}
            onSelect={run(() => deleteNode(state.selectedNodeId))}
          />
        </>
      )}
    </MenuDropdown>
  );
}
