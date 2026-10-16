import { flattenSceneTreeInOrder, getLabel, LABEL_COLORS, LABEL_COLUMNS, LABEL_ROWS, labelCell, labelDisplayText, outerNodeId, getSpriteAnimations, getSpriteByteSize, getSpriteFrames, getSpriteTransform, getTouchArea2D, DS_HARDWARE_PROFILE, type ScreenId, type SceneNode } from "@goodstuff/core";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { NodeIcon } from "../NodeIcon";
import { useEditorStore, type EditorState } from "../state/editor-store";
import { useShownSceneRoot } from "../state/shown-scene";
import { spriteDataUrl, spriteFrameDataUrl } from "./sprite-image";

const SCALE = 2;
const SCREEN_W = DS_HARDWARE_PROFILE.screens.width * SCALE;
const SCREEN_H = DS_HARDWARE_PROFILE.screens.height * SCALE;
const EDITOR_ACCENT = "#4fa8ff";
/** Screen pixels a pointer must travel before a press-and-release counts as a box-select drag rather than a click. */
const BOX_SELECT_DRAG_THRESHOLD = 6;

/** Node kinds that render as something visible/draggable on a screen. */
const VISUAL_KINDS = new Set(["Sprite2D", "AnimatedSprite2D", "Camera2D", "Label", "Area2D", "TouchArea2D"]);

/** A small icon marker's fixed footprint (Camera2D, Area2D, a spriteless Sprite2D/AnimatedSprite2D): no natural size of its own, so one is picked close to the icon box `NodeMarker`'s own default branch renders. */
const ICON_MARKER_SIZE = 24;

/**
 * Where a node's own marker renders, in the same unscaled DS-pixel coordinate space as `node.position` (multiply
 * by `SCALE` for screen pixels): the top-left corner and size `NodeMarker` draws it at. Shared between that
 * rendering and `ScreenCanvas`'s own box-select hit test so the two can never disagree about where a node's marker
 * actually is.
 */
function nodeMarkerRect(node: SceneNode, state: EditorState): { left: number; top: number; width: number; height: number } {
  // A TouchArea2D is its rectangle on the touch screen, centered on its position (the ROM tests the same rectangle).
  if (node.kind === "TouchArea2D") {
    const area = getTouchArea2D(node);
    return { left: node.position.x - area.width / 2, top: node.position.y - area.height / 2, width: area.width, height: area.height };
  }
  // A Label is its text in the DS's 8 x 8 grid, one character to a cell, wrapping at the screen's edge as the ROM's text does.
  if (node.kind === "Label") {
    const data = getLabel(node);
    const cell = labelCell(node.position);
    const shownText = Array.from(labelDisplayText(data.text, 0));
    const width = Math.max(1, Math.min(shownText.length, LABEL_COLUMNS - cell.column));
    return { left: cell.column * 8, top: cell.row * 8, width: width * 8, height: 8 };
  }
  // A Sprite2D with an image is drawn as that image, centered on its position; one without falls through to the icon marker below.
  const isSprite = node.kind === "Sprite2D" || node.kind === "AnimatedSprite2D";
  const image = isSprite && node.spriteId ? state.project?.sprites?.find((sprite) => sprite.id === node.spriteId) : undefined;
  const frames = image ? getSpriteFrames(image) : null;
  if (image && frames) {
    return { left: node.position.x - frames.frameWidth / 2, top: node.position.y - frames.frameHeight / 2, width: frames.frameWidth, height: frames.frameHeight };
  }
  return {
    left: node.position.x - ICON_MARKER_SIZE / 2,
    top: node.position.y - ICON_MARKER_SIZE / 2,
    width: ICON_MARKER_SIZE,
    height: ICON_MARKER_SIZE
  };
}

/** Whether two axis-aligned rects (same unscaled DS-pixel space as `nodeMarkerRect`) overlap at all. */
function rectsIntersect(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

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
    const rect = nodeMarkerRect(node, state);
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (touch area, ${area.width} x ${area.height})`}
        data-testid="touch-area-rect"
        data-node-id={node.id}
        style={{ left: rect.left * SCALE, top: rect.top * SCALE, width: rect.width * SCALE, height: rect.height * SCALE }}
        className={`absolute cursor-grab border border-dashed ${
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
    const rect = nodeMarkerRect(node, state);
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (label, column ${cell.column}, row ${cell.row})`}
        data-testid="label-text"
        data-node-id={node.id}
        style={{ left: rect.left * SCALE, top: rect.top * SCALE, width: rect.width * SCALE, height: rect.height * SCALE, color: LABEL_COLORS[data.color].css }}
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
    const rect = nodeMarkerRect(node, state);
    return (
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`${node.name} (${frames.frameWidth} x ${frames.frameHeight}${frames.count > 1 ? `, ${frames.count} frames` : ""}, ${getSpriteByteSize(image)} bytes)`}
        data-testid="sprite-image"
        data-node-id={node.id}
        style={{ left: rect.left * SCALE, top: rect.top * SCALE, width: rect.width * SCALE, height: rect.height * SCALE }}
        className={`absolute cursor-grab ${isSelected ? "outline outline-1 outline-editor-accent" : ""}`}
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

/**
 * Click-drag a rectangle over the screen to select every node it swept over, while box-select mode (the B toggle,
 * `EditorState.boxSelectActive`, `WorkspaceToolbar.tsx`) is on -- the 2D equivalent of `BoxSelectController`
 * (Viewport3D.tsx), much simpler here: no camera, no projection, and no orbit-control conflict to manage, since
 * `NodeMarker`'s own `onPointerDown` already calls `stopPropagation()`, so this div's own handlers only ever fire
 * for a gesture that started on empty space -- the same thing that already made a plain click here mean "deselect
 * to the scene root", and still does when box-select mode is off.
 */
function ScreenCanvas({ screen, nodes, note }: { screen: ScreenId; nodes: SceneNode[]; note?: string }): JSX.Element {
  const { selectNode, selectNodes, state } = useEditorStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const localPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Box-select mode off (the B toggle, WorkspaceToolbar.tsx): today's original behavior, unchanged -- a
      // gesture starting on empty space (a node's own onPointerDown already stopped propagation otherwise)
      // deselects to the scene root immediately, no drag tracking at all.
      if (!state.boxSelectActive) {
        selectNode(state.sceneRoot.id);
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      const p = localPoint(event);
      dragRef.current = { pointerId: event.pointerId, startX: p.x, startY: p.y };
    },
    [state.boxSelectActive, state.sceneRoot.id, selectNode, localPoint]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const p = localPoint(event);
      const width = Math.abs(p.x - drag.startX);
      const height = Math.abs(p.y - drag.startY);
      // Only shown once the drag is clearly intentional, not a click's own tiny jitter.
      setDragRect(width > BOX_SELECT_DRAG_THRESHOLD || height > BOX_SELECT_DRAG_THRESHOLD ? { left: Math.min(drag.startX, p.x), top: Math.min(drag.startY, p.y), width, height } : null);
    },
    [localPoint]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setDragRect(null);
      if (!drag) return;
      const p = localPoint(event);
      // The same box either way: a plain click's own near-zero box naturally matches no node's marker (it can only
      // start here at all if it missed every one of them), which is exactly the same "select the scene root"
      // result `selectNode(sceneRoot.id)` used to give directly.
      const box = {
        left: Math.min(drag.startX, p.x) / SCALE,
        top: Math.min(drag.startY, p.y) / SCALE,
        width: Math.abs(p.x - drag.startX) / SCALE,
        height: Math.abs(p.y - drag.startY) / SCALE
      };
      selectNodes(nodes.filter((node) => node.visible && rectsIntersect(nodeMarkerRect(node, state), box)).map((node) => node.id));
    },
    [localPoint, nodes, selectNodes, state]
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-editor-text-muted">{screen} screen{note ? ` · ${note}` : ""}</span>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
        {dragRect && (
          <div
            data-testid="box-select-rect"
            className="pointer-events-none absolute border"
            style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height, borderColor: EDITOR_ACCENT, backgroundColor: "rgba(79, 168, 255, 0.15)" }}
          />
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
