import { getAnimationPlayer, type SceneNode } from "@goodstuff/core";
import { useEffect, useState } from "react";

import { useEditorStore } from "../state/editor-store";
import { buttonClasses, Field, inputClasses, NumberInput } from "./inspector-fields";

/**
 * The Inspector of an AnimationPlayer (requirements/animation/TASK.animation-timeline-editor.md): which of its animations autoplays, its speed, and its
 * animations (New, Rename, Delete). The timeline itself is in the Animation panel of the bottom dock.
 */
export function AnimationPlayerField({ node }: { node: SceneNode }): JSX.Element {
  const { state, animations } = useEditorStore();
  const data = getAnimationPlayer(node);
  // The panel's selected animation, when the panel is on this player.
  const selected = data.animations.find((animation) => state.animationUi.playerId === node.id && animation.id === state.animationUi.animationId) ?? data.animations[0];
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setConfirmingDelete(false), [selected?.id]);

  return (
    <div className="flex flex-col gap-2.5" data-testid="animation-player">
      <Field label="Autoplay">
        <select
          value={data.autoplay ?? ""}
          onChange={(event) => animations.setPlayer(node.id, { autoplay: event.target.value === "" ? null : event.target.value })}
          className={inputClasses}
          aria-label="Autoplay"
        >
          <option value="">None</option>
          {data.animations.map((animation) => (
            <option key={animation.id} value={animation.id}>
              {animation.name}
            </option>
          ))}
        </select>
      </Field>
      <NumberInput label="Speed" value={data.speed} onChange={(speed) => animations.setPlayer(node.id, { speed })} />

      <div className="flex flex-col gap-1 rounded border border-editor-border bg-editor-panel-alt p-2">
        <div className="text-xs font-semibold text-editor-text-muted">Animations</div>
        {data.animations.length === 0 && <div className="text-[11px] text-editor-text-muted">No animations yet.</div>}
        <div role="listbox" aria-label="Animations" className="flex flex-col gap-0.5">
          {data.animations.map((animation) => (
            <button
              key={animation.id}
              type="button"
              role="option"
              aria-selected={animation.id === selected?.id}
              onClick={() => animations.ui({ playerId: node.id, animationId: animation.id, trackId: null, keyTime: null, previewTime: null, previewPlaying: false })}
              className={`flex items-center justify-between rounded px-2 py-0.5 text-left text-xs ${
                animation.id === selected?.id ? "bg-editor-accent/25 text-editor-text" : "text-editor-text-muted hover:bg-editor-panel"
              }`}
            >
              <span className="truncate">{animation.name}</span>
              <span className="shrink-0 text-[10px]">{animation.length}s{animation.loop ? " ↻" : ""}</span>
            </button>
          ))}
        </div>
        <button type="button" className={buttonClasses} onClick={() => animations.create(node.id)}>
          New Animation
        </button>
        {selected && (
          <>
            <Field label="Name">
              <RenameField key={selected.id} value={selected.name} onRename={(name) => animations.rename(node.id, selected.id, name)} />
            </Field>
            {confirmingDelete ? (
              <div className="flex items-center gap-2 text-xs text-editor-text-muted">
                <span>Delete "{selected.name}"?</span>
                <button type="button" className={`${buttonClasses} border-red-500/60`} onClick={() => animations.remove(node.id, selected.id)}>
                  Delete
                </button>
                <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(true)}>
                Delete Animation
              </button>
            )}
          </>
        )}
      </div>
      <div className="text-[10px] text-editor-text-muted">
        An animation does nothing until it is this player's Autoplay or a script starts it: <span className="font-mono">$Player.play("name")</span>. Keyframes are set in the Animation panel below.
      </div>
    </div>
  );
}

/** A name that keeps its own text while typed in (an empty or repeated name isn't applied, and the field shows the real one again when left). */
function RenameField({ value, onRename }: { value: string; onRename: (name: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (document.activeElement?.getAttribute("aria-label") !== "Animation name") setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      aria-label="Animation name"
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() !== "") onRename(event.target.value);
      }}
      onBlur={() => setDraft(value)}
      className={inputClasses}
    />
  );
}
