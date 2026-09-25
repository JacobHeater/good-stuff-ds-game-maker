import {
  animatableProperties,
  flattenSceneTree,
  findSceneNode,
  getAnimationPlayer,
  valueKindOf,
  type Animation,
  type AnimationKey,
  type AnimationProperty,
  type AnimationTrack,
  type AnimationValue,
  type SceneNode,
  type Vector3
} from "@goodstuff/core";
import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../state/editor-store";
import { buttonClasses, inputClasses, NumberInput } from "./inspector-fields";

/**
 * The Animation panel (requirements/animation/TASK.animation-timeline-editor.md), a tab of the bottom dock: the selected AnimationPlayer's animation, its tracks
 * on the left and a timeline on the right with a key marker for each key and a playhead. The playhead and the Play button preview the animation in the 3D
 * viewport (the preview is display only: see `animationUi` in the store).
 */

const seconds = (t: number): string => (Math.round(t * 100) / 100).toFixed(2);
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

/** Where (as a fraction of the timeline's width) a time is. */
const at = (time: number, length: number): number => (length <= 0 ? 0 : Math.min(1, Math.max(0, time / length)));

function TrackLabel({ track, root }: { track: AnimationTrack; root: SceneNode }): JSX.Element {
  const node = findSceneNode(root, track.nodeId);
  return (
    <span className="truncate">
      {node?.name ?? "?"}: {track.property}
    </span>
  );
}

/** Edits a key's value: X/Y/Z for a vector, a number, or a checkbox for a bool. */
function KeyValueFields({ property, value, onChange }: { property: AnimationProperty; value: AnimationValue; onChange: (value: AnimationValue) => void }): JSX.Element {
  const kind = valueKindOf(property);
  if (kind === "bool") {
    return (
      <label className="flex items-center gap-1 text-xs text-editor-text-muted">
        <input type="checkbox" aria-label="Value" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        Visible
      </label>
    );
  }
  if (kind === "number") return <NumberInput label="Value" value={value as number} onChange={onChange} />;
  const vector = value as Vector3;
  return (
    <div className="flex gap-1">
      {(["x", "y", "z"] as const).map((axis) => (
        <NumberInput key={axis} label={`Value ${axis.toUpperCase()}`} value={vector[axis]} onChange={(v) => onChange({ ...vector, [axis]: v })} />
      ))}
    </div>
  );
}

export function AnimationPanel(): JSX.Element {
  const { state } = useEditorStore();
  // The player being edited: the last AnimationPlayer selected (it stays while other nodes are selected), or the selected one.
  const edited = state.animationUi.playerId ? findSceneNode(state.sceneRoot, state.animationUi.playerId) : undefined;
  const selected = findSceneNode(state.sceneRoot, state.selectedNodeId);
  const player = edited?.kind === "AnimationPlayer" ? edited : selected?.kind === "AnimationPlayer" ? selected : undefined;
  if (!player) {
    return <div className="p-3 text-xs text-editor-text-muted">Select an AnimationPlayer node to edit its animations.</div>;
  }
  return <PlayerTimeline player={player} />;
}

function PlayerTimeline({ player }: { player: SceneNode }): JSX.Element {
  const { state, animations } = useEditorStore();
  const ui = state.animationUi;
  const data = getAnimationPlayer(player);
  const animation: Animation | undefined = data.animations.find((a) => a.id === ui.animationId) ?? data.animations[0];
  const track = animation?.tracks.find((t) => t.id === ui.trackId);
  const key: AnimationKey | undefined = track?.keys.find((k) => k.time === ui.keyTime);
  const timeline = useRef<HTMLDivElement>(null);
  const [addNodeId, setAddNodeId] = useState<string>("");
  const [addProperty, setAddProperty] = useState<AnimationProperty | "">("");

  // ---- The preview loop: while playing, the playhead advances at the player's speed; the end of a one-shot animation (or Stop) ends the preview.
  const live = useRef({ ui, animation, speed: data.speed });
  live.current = { ui, animation, speed: data.speed };
  useEffect(() => {
    if (!ui.previewPlaying) return undefined;
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const { ui: current, animation: playing, speed } = live.current;
      const dt = ((now - last) / 1000) * speed;
      last = now;
      if (!playing || current.previewTime === null) return;
      const next = current.previewTime + dt;
      if (next >= playing.length) {
        if (playing.loop && playing.length > 0) animations.ui({ previewTime: next % playing.length });
        else {
          animations.ui({ previewTime: null, previewPlaying: false });
          return;
        }
      } else {
        animations.ui({ previewTime: next });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Restarted only when playing starts or stops; the loop reads the rest from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.previewPlaying, animation?.id]);

  if (!animation) {
    return (
      <div className="flex items-center gap-3 p-3 text-xs text-editor-text-muted" data-testid="animation-panel">
        <span>{player.name} has no animations yet.</span>
        <button type="button" className={buttonClasses} onClick={() => animations.create(player.id)}>
          New Animation
        </button>
      </div>
    );
  }

  const animatable = flattenSceneTree(state.sceneRoot).filter((node) => node.id !== player.id && animatableProperties(node.kind).length > 0);
  const chosenNode = animatable.find((node) => node.id === addNodeId) ?? animatable[0];
  const freeProperties = chosenNode ? animatableProperties(chosenNode.kind).filter((p) => !animation.tracks.some((t) => t.nodeId === chosenNode.id && t.property === p)) : [];
  const chosenProperty = freeProperties.includes(addProperty as AnimationProperty) ? (addProperty as AnimationProperty) : freeProperties[0];

  const playhead = ui.previewTime ?? 0;
  const step = TICK_STEPS.find((s) => animation.length / s <= 12) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= animation.length + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);

  const timeFromPointer = (clientX: number): number => {
    const box = timeline.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(fraction * animation.length * 100) / 100;
  };
  const scrub = (event: React.PointerEvent): void => {
    animations.ui({ previewTime: timeFromPointer(event.clientX), previewPlaying: false });
  };

  return (
    <div className="flex h-full flex-col text-xs" data-testid="animation-panel">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-editor-border px-2 py-1">
        <select
          value={animation.id}
          aria-label="Animation"
          onChange={(event) => animations.ui({ animationId: event.target.value, trackId: null, keyTime: null, previewTime: null, previewPlaying: false })}
          className={inputClasses}
        >
          {data.animations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="button" className={buttonClasses} onClick={() => animations.create(player.id)}>
          New Animation
        </button>
        <div className="w-24">
          <NumberInput key={animation.id} label="Length (s)" value={animation.length} onChange={(length) => animations.set(player.id, animation.id, { length })} />
        </div>
        <label className="flex items-center gap-1 text-editor-text-muted">
          <input type="checkbox" aria-label="Loop" checked={animation.loop} onChange={(event) => animations.set(player.id, animation.id, { loop: event.target.checked })} />
          Loop
        </label>
        <button
          type="button"
          className={buttonClasses}
          aria-label={ui.previewPlaying ? "Stop preview" : "Play preview"}
          onClick={() => (ui.previewPlaying ? animations.ui({ previewPlaying: false, previewTime: null }) : animations.ui({ previewPlaying: true, previewTime: ui.previewTime !== null && ui.previewTime < animation.length ? ui.previewTime : 0 }))}
        >
          {ui.previewPlaying ? "Stop" : "Play"}
        </button>
        {ui.previewTime !== null && (
          <button type="button" className={buttonClasses} onClick={() => animations.ui({ previewTime: null, previewPlaying: false })}>
            End Preview
          </button>
        )}
        <span className="tabular-nums text-editor-text-muted" data-testid="animation-time">
          {seconds(playhead)} / {seconds(animation.length)} s{ui.previewTime !== null ? " (previewing)" : ""}
        </span>
        <span className="mx-1 h-4 border-l border-editor-border" />
        <select value={chosenNode?.id ?? ""} aria-label="Track node" onChange={(event) => setAddNodeId(event.target.value)} className={inputClasses}>
          {animatable.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
        <select value={chosenProperty ?? ""} aria-label="Track property" onChange={(event) => setAddProperty(event.target.value as AnimationProperty)} className={inputClasses}>
          {freeProperties.map((property) => (
            <option key={property} value={property}>
              {property}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={buttonClasses}
          disabled={!chosenNode || !chosenProperty}
          onClick={() => chosenNode && chosenProperty && animations.addTrack(player.id, animation.id, chosenNode.id, chosenProperty)}
        >
          Add Track
        </button>
        <button type="button" className={buttonClasses} disabled={!track} onClick={() => track && animations.addKey(player.id, animation.id, track.id, playhead)}>
          Add Key
        </button>
        <button type="button" className={buttonClasses} disabled={!track || !key} onClick={() => track && key && animations.removeKey(player.id, animation.id, track.id, key.time)}>
          Delete Key
        </button>
        <button type="button" className={buttonClasses} disabled={!track} onClick={() => track && animations.removeTrack(player.id, animation.id, track.id)}>
          Delete Track
        </button>
      </div>

      {/* Tracks and timeline */}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-52 shrink-0 border-r border-editor-border">
          <div className="h-6 border-b border-editor-border px-2 py-1 text-editor-text-muted">Tracks</div>
          {animation.tracks.length === 0 && <div className="p-2 text-editor-text-muted">No tracks. Choose a node and property above and press Add Track.</div>}
          {animation.tracks.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid="track-row"
              aria-pressed={t.id === ui.trackId}
              onClick={() => animations.ui({ trackId: t.id, keyTime: null })}
              className={`flex h-7 w-full items-center px-2 text-left ${t.id === ui.trackId ? "bg-editor-accent/25 text-editor-text" : "text-editor-text-muted hover:bg-editor-panel-alt"}`}
            >
              <TrackLabel track={t} root={state.sceneRoot} />
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 px-3">
          <div ref={timeline} className="relative" data-testid="animation-timeline">
            <div className="relative h-6 cursor-pointer border-b border-editor-border" data-testid="animation-ruler" onPointerDown={(event) => { (event.target as HTMLElement).setPointerCapture?.(event.pointerId); scrub(event); }} onPointerMove={(event) => { if (event.buttons === 1) scrub(event); }}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-editor-border pl-1 text-[10px] text-editor-text-muted" style={{ left: `${at(t, animation.length) * 100}%` }}>
                  {t}
                </div>
              ))}
            </div>
            {animation.tracks.map((t) => (
              <div key={t.id} className={`relative h-7 border-b border-editor-border ${t.id === ui.trackId ? "bg-editor-accent/10" : ""}`} data-testid="timeline-row">
                {t.keys.map((k) => (
                  <button
                    key={k.time}
                    type="button"
                    data-testid="key-marker"
                    data-time={k.time}
                    aria-pressed={t.id === ui.trackId && k.time === ui.keyTime}
                    title={`${t.property} at ${k.time} s`}
                    onClick={() => animations.ui({ trackId: t.id, keyTime: k.time })}
                    className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
                      t.id === ui.trackId && k.time === ui.keyTime ? "border-white bg-editor-accent" : "border-editor-border bg-editor-text-muted hover:bg-editor-accent/60"
                    }`}
                    style={{ left: `${at(k.time, animation.length) * 100}%` }}
                  />
                ))}
              </div>
            ))}
            {ui.previewTime !== null && <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-400" data-testid="playhead" style={{ left: `${at(ui.previewTime, animation.length) * 100}%` }} />}
          </div>
        </div>
      </div>

      {/* The selected key */}
      {track && key && (
        <div className="flex shrink-0 items-end gap-3 border-t border-editor-border px-2 py-1" data-testid="key-editor">
          <span className="pb-1 text-editor-text-muted">
            <TrackLabel track={track} root={state.sceneRoot} />
          </span>
          <div className="w-24">
            <NumberInput key={`${track.id}-time`} label="Time (s)" value={key.time} onChange={(time) => animations.setKey(player.id, animation.id, track.id, key.time, { time })} />
          </div>
          <KeyValueFields key={`${track.id}-${key.time}`} property={track.property} value={key.value} onChange={(value) => animations.setKey(player.id, animation.id, track.id, key.time, { value })} />
        </div>
      )}
    </div>
  );
}
