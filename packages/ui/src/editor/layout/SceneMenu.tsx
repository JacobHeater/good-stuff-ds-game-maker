import { getNodeKindsForMode } from "@goodstuff/core";

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
  const { state, addNode, deleteNode, duplicateNode } = useEditorStore();
  const hasSelection = state.selectedNodeId !== state.sceneRoot.id;
  const mode = state.project?.mode;

  return (
    <MenuDropdown label="Scene">
      {(run) => (
        <>
          {mode && (
            <>
              <MenuSectionLabel label={`Add ${mode} Node`} />
              {getNodeKindsForMode(mode).map((kind) => (
                <MenuItem key={kind} label={kind} icon={NODE_KIND_ICON[kind]} onSelect={run(() => addNode(kind))} />
              ))}
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
