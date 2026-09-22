import type { SceneNode } from "@goodstuff/core";

import { NODE_KIND_ICON } from "../node-icons";
import { useEditorStore } from "../state/editor-store";

function TreeRow({ node, depth }: { node: SceneNode; depth: number }): JSX.Element {
  const { state, selectNode, toggleVisible } = useEditorStore();
  const isSelected = state.selectedNodeId === node.id;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectNode(node.id)}
        style={{ paddingLeft: depth * 14 + 8 }}
        className={`flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 text-xs ${
          isSelected ? "bg-editor-accent/25 text-editor-text" : "text-editor-text-muted hover:bg-editor-panel-alt"
        }`}
      >
        <span className="w-4 text-center">{NODE_KIND_ICON[node.kind]}</span>
        <span className="flex-1 truncate">{node.name}</span>
        <span className="rounded bg-editor-panel-alt px-1 text-[10px] uppercase text-editor-text-muted">
          {node.screen}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleVisible(node.id);
          }}
          className="text-[11px]"
          title={node.visible ? "Hide node" : "Show node"}
        >
          {node.visible ? "👁" : "🚫"}
        </button>
      </div>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

/**
 * The Scene dock, listing the active scene's nodes as a tree.
 * (Officially "Scene dock" in Godot; commonly called the "node tree".)
 */
export function SceneTreePanel(): JSX.Element {
  const { state } = useEditorStore();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        Scene Tree
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <TreeRow node={state.sceneRoot} depth={0} />
      </div>
    </div>
  );
}
