import { flattenSceneTreeInOrder, getLabel, LABEL_COLORS, LABEL_COLUMNS, LABEL_ROWS, labelCell, labelDisplayText, outerNodeId, getSpriteAnimations, getSpriteByteSize, getSpriteFrames, getSpriteTransform, getTouchArea2D, DS_HARDWARE_PROFILE, type ScreenId, type SceneNode } from "@goodstuff/core";
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { NodeIcon } from "../NodeIcon";
import { useEditorStore } from "../state/editor-store";
import { useShownSceneRoot } from "../state/shown-scene";
import { spriteDataUrl, spriteFrameDataUrl } from "./sprite-image";

const SCALE = 2;
const SCREEN_W = DS_HARDWARE_PROFILE.screens.width * SCALE;
const SCREEN_H = DS_HARDWARE_PROFILE.screens.height * SCALE;

/** Node kinds that render as something visible/draggable on a screen. */
const VISUAL_KINDS = new Set(["Sprite2D", "AnimatedSprite2D", "Camera2D", "Label", "Area2D", "TouchArea2D"]);

function NodeMarker({ node }: { node: SceneNode }): JSX.Element {
  const { state, selectNode, moveNode, endEditGesture } = useEditorStore();
  const isSelected = state.selectedNodeId === outerNodeId(node.id);
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
      // A label sits on the 8 x 8 grid of the DS's text, so it moves a cell at a time.
      const snap = node.kind === "Label" ? 8 : 1;
      moveNode(node.id, Math.round((drag.originX + dx) / snap) * snap, Math.round((drag.originY + dy) / snap) * snap);
    },
    [moveNode, node.id]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      endEditGesture(); // the marker was released: the next drag is a new undo step
    },
    [endEditGesture]
  );

  if (!node.visible) return <></>;

  // A TouchArea2D is its rectangle on the touch screen, centered on its position (the ROM tests the same rectangle).
  if (node.kind === "TouchArea2D") {
    const area = getTouchArea2D(node);
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (touch area, ${area.width} x ${area.height})`}
        data-testid="touch-area-rect"
        data-node-id={node.id}
        style={{ left: node.position.x * SCALE, top: node.position.y * SCALE, width: area.width * SCALE, height: area.height * SCALE }}
        className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab border border-dashed ${
          isSelected ? "border-editor-accent bg-editor-accent/20" : "border-teal-300/70 bg-teal-300/10"
        }`}
      >
        <span className="absolute left-0.5 top-0.5 flex items-center gap-0.5 rounded bg-editor-bg/70 px-1 text-[9px] text-editor-text-muted">
          <NodeIcon kind={node.kind} className="h-3 w-3" /> {node.name}
        </span>
      </div>
    );
  }

  // A Label is its text in the DS's 8 x 8 grid, one character to a cell, wrapping at the screen's edge as the ROM's text does (a script's value shows where the {} are; before a script runs it is 0).
  if (node.kind === "Label") {
    const data = getLabel(node);
    const cell = labelCell(node.position);
    const shownText = Array.from(labelDisplayText(data.text, 0));
    const width = Math.max(1, Math.min(shownText.length, LABEL_COLUMNS - cell.column));
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (label, column ${cell.column}, row ${cell.row})`}
        data-testid="label-text"
        data-node-id={node.id}
        style={{ left: cell.column * 8 * SCALE, top: cell.row * 8 * SCALE, width: width * 8 * SCALE, height: 8 * SCALE, color: LABEL_COLORS[data.color].css }}
        className={`absolute cursor-grab font-mono ${isSelected ? "outline outline-1 outline-editor-accent" : ""}`}
      >
        {shownText.map((character, i) => {
          const column = cell.column + i;
          const row = cell.row + Math.floor(column / LABEL_COLUMNS);
          if (row >= LABEL_ROWS) return null;
          return (
            <span
              key={i}
              className="pointer-events-none absolute select-none whitespace-pre text-center"
              style={{ left: ((column % LABEL_COLUMNS) - cell.column) * 8 * SCALE, top: (row - cell.row) * 8 * SCALE, width: 8 * SCALE, fontSize: 8 * SCALE - 2, lineHeight: `${8 * SCALE}px` }}
            >
              {character}
            </span>
          );
        })}
      </div>
    );
  }

  // A Sprite2D with an image is drawn as that image, centered on its position (the ROM draws it the same way); one without is a marker. An AnimatedSprite2D is drawn as
  // the frame it starts on (the first frame of the animation it starts with, or frame 0), and a Sprite2D given a sheet shows frame 0: what the ROM shows the moment it starts.
  const isSprite = node.kind === "Sprite2D" || node.kind === "AnimatedSprite2D";
  const image = isSprite && node.spriteId ? state.project?.sprites?.find((sprite) => sprite.id === node.spriteId) : undefined;
  const frames = image ? getSpriteFrames(image) : null;
  const startAnimation = node.kind === "AnimatedSprite2D" ? getSpriteAnimations(node).animations.find((animation) => animation.name === getSpriteAnimations(node).start) : undefined;
  const url = image && frames ? (frames.count > 1 ? spriteFrameDataUrl(image, startAnimation?.frames[0] ?? 0) : spriteDataUrl(image)) : null;
  if (image && frames && url) {
    // The picture turns and scales about its center (the node's position), as the ROM's rotation matrix does: rotation in degrees, clockwise.
    const transform = getSpriteTransform(node);
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (${frames.frameWidth} x ${frames.frameHeight}${frames.count > 1 ? `, ${frames.count} frames` : ""}, ${getSpriteByteSize(image)} bytes)`}
        data-testid="sprite-image"
        data-node-id={node.id}
        style={{ left: node.position.x * SCALE, top: node.position.y * SCALE, width: frames.frameWidth * SCALE, height: frames.frameHeight * SCALE }}
        className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab ${isSelected ? "outline outline-1 outline-editor-accent" : ""}`}
      >
        <img
          src={url}
          alt={node.name}
          draggable={false}
          className="h-full w-full select-none"
          style={{ imageRendering: "pixelated", rotate: `${transform.rotation}deg`, scale: `${transform.scale.x} ${transform.scale.y}` }}
        />
      </div>
    );
  }

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
        <NodeIcon kind={node.kind} className="h-5 w-5" />
      </div>
      <span className="rounded bg-editor-bg/80 px-1 text-[9px] text-editor-text-muted">{node.name}</span>
    </div>
  );
}

function ScreenCanvas({ screen, nodes, note }: { screen: ScreenId; nodes: SceneNode[]; note?: string }): JSX.Element {
  const { selectNode, state } = useEditorStore();
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-editor-text-muted">{screen} screen{note ? ` · ${note}` : ""}</span>
      <div
        onPointerDown={() => selectNode(state.sceneRoot.id)}
        style={{ width: SCREEN_W, height: SCREEN_H }}
        className="relative overflow-hidden rounded border border-editor-border bg-black/60"
      >
        {nodes.map((node) => (
          <NodeMarker key={node.id} node={node} />
        ))}
        {nodes.length === 0 && note && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[11px] text-editor-text-muted" data-testid="empty-2d-screen">
            Nothing on this 2D screen yet. Scene &gt; Add 2D Node adds a Label, Sprite2D and more.
          </div>
        )}
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
  // Tree order is drawing order: a node later in the tree is drawn over an earlier one, as in the ROM.
  const shown = useShownSceneRoot();
  const allNodes = flattenSceneTreeInOrder(shown).filter((node) => VISUAL_KINDS.has(node.kind));
  const topNodes = allNodes.filter((node) => node.screen === "top");
  const bottomNodes = allNodes.filter((node) => node.screen === "bottom");

  const showTop = state.screenFilter === "both" || state.screenFilter === "top";
  const showBottom = state.screenFilter === "both" || state.screenFilter === "bottom";
  // In a 3D project only its 2D screen comes here.
  const note = state.project?.mode === "3D" ? "2D engine" : undefined;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-6 overflow-auto bg-editor-bg p-4">
      {showTop && <ScreenCanvas screen="top" nodes={topNodes} note={note} />}
      {showBottom && <ScreenCanvas screen="bottom" nodes={bottomNodes} note={note} />}
    </div>
  );
}
