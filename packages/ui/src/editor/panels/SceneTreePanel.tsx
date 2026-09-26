import type { DropPosition, SceneNode } from "@goodstuff/core";
import { useState, type DragEvent, type MouseEvent } from "react";

import { NodeIcon } from "../NodeIcon";
import { canMoveNodes, selectedNodeIdsOf, useEditorStore } from "../state/editor-store";
import { SCENE_DRAG_TYPE } from "../layout/SceneTabs";

/** What a drag in progress is over: the row and where the dragged nodes would land relative to it. */
interface DropTarget {
  targetId: string;
  position: DropPosition;
}

const DRAG_TYPE = "application/x-goodstuff-nodes";

/** How many nodes are under `node`, at any depth. */
function countDescendants(node: SceneNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function TreeRow({
  node,
  depth,
  dragged,
  drop,
  onDragged,
  onDrop
}: {
  node: SceneNode;
  depth: number;
  dragged: string[] | null;
  drop: DropTarget | null;
  onDragged: (ids: string[] | null, over?: DropTarget | null) => void;
  onDrop: (target: DropTarget) => void;
}): JSX.Element {
  const { state, selectNode, selectNodeModified, toggleVisible, toggleCollapsed, instantiateScene } = useEditorStore();
  const selected = selectedNodeIdsOf(state);
  const isSelected = selected.includes(node.id);
  const isPrimary = state.selectedNodeId === node.id && selected.length > 1;
  const isRoot = node.id === state.sceneRoot.id;
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && state.collapsedNodeIds.includes(node.id);
  const here = drop?.targetId === node.id ? drop.position : null;

  /** Where a drag over this row would land: the top quarter is before it, the bottom quarter after it, the middle inside it; the scene root only takes children. */
  const positionAt = (event: DragEvent<HTMLDivElement>): DropPosition => {
    if (isRoot) return "inside";
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - box.top) / box.height;
    return fraction < 0.25 ? "before" : fraction > 0.75 ? "after" : "inside";
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.shiftKey) selectNodeModified(node.id, "range");
    else if (event.ctrlKey || event.metaKey) selectNodeModified(node.id, "toggle");
    else selectNode(node.id);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        draggable={!isRoot}
        data-testid="tree-row"
        data-selected={isSelected ? "true" : undefined}
        data-drop={here ?? undefined}
        onClick={onClick}
        onDragStart={(event) => {
          // Dragging a selected row drags the whole selection; dragging one that isn't selected drags just that node (and selects it).
          const ids = isSelected ? selected.filter((id) => id !== state.sceneRoot.id) : [node.id];
          if (!isSelected) selectNode(node.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAG_TYPE, ids.join(","));
          onDragged(ids);
        }}
        onDragEnd={() => onDragged(null, null)}
        onDragOver={(event) => {
          // A scene dragged from a tab: it can go into any node that isn't itself an instance.
          if (event.dataTransfer.types.includes(SCENE_DRAG_TYPE)) {
            if (node.instanceOf !== undefined) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            return;
          }
          if (!dragged) return;
          const position = positionAt(event);
          if (!canMoveNodes(state, dragged, node.id, position)) {
            if (drop) onDragged(dragged, null);
            return;
          }
          event.preventDefault(); // this is a place the nodes can be dropped
          event.dataTransfer.dropEffect = "move";
          if (drop?.targetId !== node.id || drop.position !== position) onDragged(dragged, { targetId: node.id, position });
        }}
        onDrop={(event) => {
          const sceneId = event.dataTransfer.getData(SCENE_DRAG_TYPE);
          if (sceneId) {
            event.preventDefault();
            event.stopPropagation();
            instantiateScene(sceneId, node.id);
            return;
          }
          if (!dragged) return;
          event.preventDefault();
          const position = positionAt(event);
          if (canMoveNodes(state, dragged, node.id, position)) onDrop({ targetId: node.id, position });
          else onDragged(null, null);
        }}
        style={{ paddingLeft: depth * 14 + 8 }}
        className={`flex cursor-pointer select-none items-center gap-1.5 border-y-2 border-transparent py-0.5 pr-2 text-xs ${
          isSelected ? (isPrimary || selected.length === 1 ? "bg-editor-accent/25 text-editor-text" : "bg-editor-accent/15 text-editor-text") : "text-editor-text-muted hover:bg-editor-panel-alt"
        } ${dragged?.includes(node.id) ? "opacity-50" : ""} ${here === "before" ? "!border-t-editor-accent" : ""} ${here === "after" ? "!border-b-editor-accent" : ""} ${
          here === "inside" ? "bg-editor-accent/30 outline outline-1 -outline-offset-1 outline-editor-accent" : ""
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            data-testid="tree-toggle"
            aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            aria-expanded={!collapsed}
            title={collapsed ? "Show children" : "Hide children"}
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(node.id);
            }}
            className="w-3 shrink-0 text-[8px] leading-none text-editor-text-muted hover:text-editor-text"
          >
            {collapsed ? "▶" : "▼"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="flex w-4 justify-center"><NodeIcon kind={node.kind} /></span>
        <span className="flex-1 truncate">{node.name}</span>
        {collapsed && (
          <span className="rounded bg-editor-panel-alt px-1 text-[10px] text-editor-text-muted" data-testid="tree-hidden-count" title="Nodes hidden inside">
            {countDescendants(node)}
          </span>
        )}
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
      {!collapsed && node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} dragged={dragged} drop={drop} onDragged={onDragged} onDrop={onDrop} />
      ))}
    </div>
  );
}

/**
 * The Scene dock, listing the active scene's nodes as a tree.
 * (Officially "Scene dock" in Godot; commonly called the "node tree".)
 *
 * A node with children has an arrow to fold them away (with a count of what is hidden); "Collapse all" and "Expand all" in the header do every node at once. Folding is only how
 * the tree looks: it isn't saved and isn't an undo step, and selecting a node that is inside a folded one opens the way to it.
 * Click selects a node; Ctrl+click adds it to or takes it out of the selection; Shift+click selects the range from the last node clicked. Dragging a row (or the whole
 * selection) onto another moves it: onto the top or bottom edge of a row puts it before or after that node, onto the middle makes it a child.
 * See requirements/node-list/STORY.select-and-reorder-nodes.md.
 */
export function SceneTreePanel(): JSX.Element {
  const { state, moveNodes, collapseAll, expandAll, instantiateScene } = useEditorStore();
  const [dragged, setDragged] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  const onDragged = (ids: string[] | null, over?: DropTarget | null): void => {
    setDragged(ids);
    if (over !== undefined) setDrop(over);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        <span>Scene Tree</span>
        <span className="flex gap-1">
          <button type="button" data-testid="collapse-all" title="Collapse all" aria-label="Collapse all" onClick={collapseAll} className="rounded px-1 text-[10px] hover:bg-editor-panel-alt hover:text-editor-text">
            ▶▶
          </button>
          <button type="button" data-testid="expand-all" title="Expand all" aria-label="Expand all" onClick={expandAll} className="rounded px-1 text-[10px] hover:bg-editor-panel-alt hover:text-editor-text">
            ▼▼
          </button>
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(SCENE_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const sceneId = event.dataTransfer.getData(SCENE_DRAG_TYPE);
          if (!sceneId) return;
          event.preventDefault();
          instantiateScene(sceneId, state.sceneRoot.id);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}>
        <TreeRow
          node={state.sceneRoot}
          depth={0}
          dragged={dragged}
          drop={drop}
          onDragged={onDragged}
          onDrop={(target) => {
            if (dragged) moveNodes(dragged, target.targetId, target.position);
            setDragged(null);
            setDrop(null);
          }}
        />
      </div>
    </div>
  );
}
