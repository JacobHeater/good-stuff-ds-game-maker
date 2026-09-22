import { flattenSceneTree, DS_HARDWARE_PROFILE, type ScreenId, type SceneNode } from "@goodstuff/core";
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { NODE_KIND_ICON } from "../node-icons";
import { useEditorStore } from "../state/editor-store";

const SCALE = 2;
const SCREEN_W = DS_HARDWARE_PROFILE.screens.width * SCALE;
const SCREEN_H = DS_HARDWARE_PROFILE.screens.height * SCALE;

/** Node kinds that render as something visible/draggable on a screen. */
const VISUAL_KINDS = new Set(["Sprite2D", "AnimatedSprite2D", "Camera2D", "Label", "Area2D"]);

function NodeMarker({ node }: { node: SceneNode }): JSX.Element {
  const { state, selectNode, moveNode } = useEditorStore();
  const isSelected = state.selectedNodeId === node.id;
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      selectNode(node.id);
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: node.position.x,
        originY: node.position.y
      };
    },
    [node.id, node.position.x, node.position.y, selectNode]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = (event.clientX - drag.startX) / SCALE;
      const dy = (event.clientY - drag.startY) / SCALE;
      moveNode(node.id, Math.round(drag.originX + dx), Math.round(drag.originY + dy));
    },
    [moveNode, node.id]
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }, []);

  if (!node.visible) return <></>;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ left: node.position.x * SCALE, top: node.position.y * SCALE }}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-0.5 ${
        isSelected ? "z-10" : "z-0"
      }`}
    >
      <div
        className={`flex h-6 w-6 items-center justify-center rounded border text-sm ${
          isSelected ? "border-editor-accent bg-editor-accent/30" : "border-editor-border bg-editor-panel-alt"
        }`}
      >
        {NODE_KIND_ICON[node.kind]}
      </div>
      <span className="rounded bg-editor-bg/80 px-1 text-[9px] text-editor-text-muted">{node.name}</span>
    </div>
  );
}

function ScreenCanvas({ screen, nodes }: { screen: ScreenId; nodes: SceneNode[] }): JSX.Element {
  const { selectNode, state } = useEditorStore();
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-editor-text-muted">{screen} screen</span>
      <div
        onPointerDown={() => selectNode(state.sceneRoot.id)}
        style={{ width: SCREEN_W, height: SCREEN_H }}
        className="relative overflow-hidden rounded border border-editor-border bg-black/60"
      >
        {nodes.map((node) => (
          <NodeMarker key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}

/**
 * The dual-screen viewport: the DS-specific equivalent of Godot's 2D scene
 * canvas, rendering the physical top and bottom screens side by side (or
 * filtered to just one) at a fixed scale matching real DS proportions.
 */
export function DualScreenViewport(): JSX.Element {
  const { state } = useEditorStore();
  const allNodes = flattenSceneTree(state.sceneRoot).filter((node) => VISUAL_KINDS.has(node.kind));
  const topNodes = allNodes.filter((node) => node.screen === "top");
  const bottomNodes = allNodes.filter((node) => node.screen === "bottom");

  const showTop = state.screenFilter === "both" || state.screenFilter === "top";
  const showBottom = state.screenFilter === "both" || state.screenFilter === "bottom";

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-6 overflow-auto bg-editor-bg p-4">
      {showTop && <ScreenCanvas screen="top" nodes={topNodes} />}
      {showBottom && <ScreenCanvas screen="bottom" nodes={bottomNodes} />}
    </div>
  );
}
