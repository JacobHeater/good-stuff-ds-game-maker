import {
  dsVolume,
  formatSoundTime,
  getAudioClip,
  getAudioPlayer,
  getSoundByteSize,
  getSoundDurationSeconds,
  MAX_EXTRA_AUDIO_CLIPS,
  PITCH_MAX,
  PITCH_MIN,
  playbackFrequency,
  type ImportedSound,
  type SceneNode
} from "@goodstuff/core";
import { useEffect, useState } from "react";

import { useSoundPreview } from "../audio/sound-preview";
import { useEditorStore } from "../state/editor-store";
import type { AudioClipChange, AudioPlayerChange } from "../state/editor-store";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

const PITCH_STEP = 0.05;

/**
 * The audio player in the Inspector of an AudioStreamPlayer (requirements/audio/STORY.import-sound-and-audio-player.md): which
 * sound it plays, a preview (play, stop, position), and the settings the ROM will use: autoplay on load, volume, pitch and loop.
 * The preview follows the settings live, using the DS's own volume level and playback rate.
 */
export function AudioPlayerField({
  node,
  sounds,
  onChooseSound,
  onImport,
  onChange,
  onGestureBoundary
}: {
  node: SceneNode;
  sounds: readonly ImportedSound[];
  onChooseSound: (soundId: string | null) => void;
  onImport: () => void;
  onChange: (change: AudioPlayerChange) => void;
  /** The pointer was pressed or released on a slider, or it lost focus: the next change is a new undo step. */
  onGestureBoundary: () => void;
}): JSX.Element {
  const { compressSound } = useEditorStore();
  const settings = getAudioPlayer(node);
  const sound = sounds.find((candidate) => candidate.id === settings.soundId);
  const missing = settings.soundId !== undefined && !sound;
  const preview = useSoundPreview(sound, settings);
  const frequency = sound ? playbackFrequency(sound.sampleRate, settings.pitch) : null;
  const volumePercent = Math.round(settings.volume * 100);

  return (
    <div className="flex flex-col gap-2.5" data-testid="audio-player">
      <Field label="Sound">
        <select
          value={settings.soundId ?? ""}
          onChange={(event) => onChooseSound(event.target.value === "" ? null : event.target.value)}
          className={inputClasses}
          aria-label="Sound"
        >
          <option value="">None</option>
          {sounds.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({formatSoundTime(getSoundDurationSeconds(candidate))}, {candidate.sampleRate} Hz)
            </option>
          ))}
          {missing && (
            <option value={settings.soundId} disabled>
              (missing sound)
            </option>
          )}
        </select>
      </Field>
      <button type="button" onClick={onImport} className={buttonClasses}>
        Import Sound...
      </button>
      {sound && (
        <div className="flex items-center gap-2 text-[10px] text-editor-text-muted">
          <span>{getSoundByteSize(sound)} bytes of the DS's sound memory.</span>
          {sound.format !== "ima-adpcm" && (
            <button
              type="button"
              className={`${buttonClasses} px-1.5 py-0.5 text-[10px]`}
              onClick={() => compressSound(sound.id)}
              title="Re-encode this sound as ima-adpcm, about a quarter the size, without needing the original file again"
            >
              Compress
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded border border-editor-border bg-editor-panel-alt p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!sound}
            onClick={() => (preview.playing ? preview.stop() : preview.play())}
            className={`${buttonClasses} w-16`}
            aria-label={preview.playing ? "Stop" : "Play"}
          >
            {preview.playing ? "Stop" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(preview.duration, 0.001)}
            step={0.01}
            value={Math.min(preview.position, Math.max(preview.duration, 0.001))}
            disabled={!sound}
            aria-label="Position"
            onChange={(event) => preview.seek(Number(event.target.value))}
            className="min-w-0 flex-1"
          />
          <span className="w-[5.5rem] text-right text-[11px] tabular-nums text-editor-text-muted" data-testid="audio-time">
            {formatSoundTime(preview.position)} / {formatSoundTime(preview.duration)}
          </span>
        </div>
        {!sound && <div className="text-[11px] text-editor-text-muted">{missing ? "This player's sound isn't in the project." : "Choose or import a sound to play it."}</div>}
      </div>

      <label className="flex items-center gap-2 text-xs text-editor-text-muted">
        <input type="checkbox" checked={settings.autoplay} onChange={(event) => onChange({ autoplay: event.target.checked })} aria-label="Autoplay on load" />
        Autoplay on load
      </label>
      {!settings.autoplay && (
        <div className="-mt-1.5 text-[10px] text-editor-text-muted">
          With Autoplay off, nothing starts this sound unless a script calls play() on it: it stays silent.
        </div>
      )}

      <Field label="Volume">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            aria-label="Volume"
            onChange={(event) => onChange({ volume: Number(event.target.value) / 100 })}
            onPointerDown={onGestureBoundary}
            onPointerUp={onGestureBoundary}
            onBlur={onGestureBoundary}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums text-editor-text-muted">{volumePercent}%</span>
        </div>
        <span className="text-[10px] text-editor-text-muted">The DS has 128 volume levels; this is level {dsVolume(settings.volume)}.</span>
      </Field>

      <Field label="Pitch">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={PITCH_MIN}
            max={PITCH_MAX}
            step={PITCH_STEP}
            value={settings.pitch}
            aria-label="Pitch"
            onChange={(event) => onChange({ pitch: Math.round(Number(event.target.value) * 100) / 100 })}
            onPointerDown={onGestureBoundary}
            onPointerUp={onGestureBoundary}
            onBlur={onGestureBoundary}
            className="flex-1"
          />
          <span className="w-12 text-right tabular-nums text-editor-text-muted">{settings.pitch.toFixed(2)}x</span>
        </div>
        <span className="text-[10px] text-editor-text-muted">
          {frequency
            ? `Plays at ${frequency.hz} Hz${frequency.clamped ? ", the most (or least) the DS's sound hardware takes" : ""}. 1x is as recorded; 2x is an octave up and twice as fast.`
            : "1x is as recorded; 2x is an octave up and twice as fast."}
        </span>
      </Field>

      <label className="flex items-center gap-2 text-xs text-editor-text-muted">
        <input type="checkbox" checked={settings.loop} onChange={(event) => onChange({ loop: event.target.checked })} aria-label="Loop" />
        Loop
      </label>

      <AudioClipsField node={node} sounds={sounds} onGestureBoundary={onGestureBoundary} />
    </div>
  );
}

/**
 * The player's own named clips (requirements/audio/STORY.named-audio-clips.md): up to `MAX_EXTRA_AUDIO_CLIPS` more
 * sounds, alongside the one above, each playable by name with `$Player.play("name")` -- the same New/rename/delete
 * list pattern as an AnimationPlayer's animations, with the clip's own sound, volume, pitch and loop below it.
 */
function AudioClipsField({ node, sounds, onGestureBoundary }: { node: SceneNode; sounds: readonly ImportedSound[]; onGestureBoundary: () => void }): JSX.Element {
  const { audioClips, compressSound } = useEditorStore();
  const data = getAudioPlayer(node);
  const clips = data.clips ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setConfirmingDelete(false), [selected?.id]);
  const clip = selected ? getAudioClip(selected) : null;
  const clipSound = clip ? sounds.find((candidate) => candidate.id === clip.soundId) : undefined;
  const set = (change: AudioClipChange): void => {
    if (clip) audioClips.set(node.id, clip.id, change);
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-editor-border bg-editor-panel-alt p-2">
      <div className="text-xs font-semibold text-editor-text-muted">Named sounds</div>
      <div className="text-[10px] text-editor-text-muted">
        Played by name from a script, alongside the sound above: <span className="font-mono">$Player.play("name")</span>.
      </div>
      {clips.length === 0 && <div className="text-[11px] text-editor-text-muted">None yet.</div>}
      <div role="listbox" aria-label="Named sounds" className="flex flex-col gap-0.5">
        {clips.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="option"
            aria-selected={candidate.id === selected?.id}
            onClick={() => setSelectedId(candidate.id)}
            className={`truncate rounded px-2 py-0.5 text-left text-xs ${
              candidate.id === selected?.id ? "bg-editor-accent/25 text-editor-text" : "text-editor-text-muted hover:bg-editor-panel"
            }`}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <button type="button" className={buttonClasses} disabled={clips.length >= MAX_EXTRA_AUDIO_CLIPS} onClick={() => setSelectedId(audioClips.create(node.id))}>
        New Named Sound
      </button>
      {clips.length >= MAX_EXTRA_AUDIO_CLIPS && <div className="text-[10px] text-editor-text-muted">A player can have at most {MAX_EXTRA_AUDIO_CLIPS} named sounds.</div>}

      {clip && (
        <>
          <Field label="Name">
            <ClipNameField key={clip.id} value={clip.name} onRename={(name) => audioClips.rename(node.id, clip.id, name)} />
          </Field>
          <Field label="Sound">
            <select
              value={clip.soundId ?? ""}
              onChange={(event) => set({ soundId: event.target.value === "" ? null : event.target.value })}
              className={inputClasses}
              aria-label="Named sound's sound"
            >
              <option value="">None</option>
              {sounds.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({formatSoundTime(getSoundDurationSeconds(candidate))}, {candidate.sampleRate} Hz)
                </option>
              ))}
              {clip.soundId !== undefined && !clipSound && (
                <option value={clip.soundId} disabled>
                  (missing sound)
                </option>
              )}
            </select>
          </Field>
          {clipSound && (
            <div className="flex items-center gap-2 text-[10px] text-editor-text-muted">
              <span>{getSoundByteSize(clipSound)} bytes of the DS's sound memory.</span>
              {clipSound.format !== "ima-adpcm" && (
                <button
                  type="button"
                  className={`${buttonClasses} px-1.5 py-0.5 text-[10px]`}
                  onClick={() => compressSound(clipSound.id)}
                  title="Re-encode this sound as ima-adpcm, about a quarter the size, without needing the original file again"
                >
                  Compress
                </button>
              )}
            </div>
          )}
          <Field label="Volume">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(clip.volume * 100)}
                aria-label="Named sound's volume"
                onChange={(event) => set({ volume: Number(event.target.value) / 100 })}
                onPointerDown={onGestureBoundary}
                onPointerUp={onGestureBoundary}
                onBlur={onGestureBoundary}
                className="flex-1"
              />
              <span className="w-10 text-right tabular-nums text-editor-text-muted">{Math.round(clip.volume * 100)}%</span>
            </div>
          </Field>
          <Field label="Pitch">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={PITCH_MIN}
                max={PITCH_MAX}
                step={0.05}
                value={clip.pitch}
                aria-label="Named sound's pitch"
                onChange={(event) => set({ pitch: Math.round(Number(event.target.value) * 100) / 100 })}
                onPointerDown={onGestureBoundary}
                onPointerUp={onGestureBoundary}
                onBlur={onGestureBoundary}
                className="flex-1"
              />
              <span className="w-12 text-right tabular-nums text-editor-text-muted">{clip.pitch.toFixed(2)}x</span>
            </div>
          </Field>
          <label className="flex items-center gap-2 text-xs text-editor-text-muted">
            <input type="checkbox" checked={clip.loop} onChange={(event) => set({ loop: event.target.checked })} aria-label="Named sound's loop" />
            Loop
          </label>
          {confirmingDelete ? (
            <div className="flex items-center gap-2 text-xs text-editor-text-muted">
              <span>Delete "{clip.name}"?</span>
              <button type="button" className={`${buttonClasses} border-red-500/60`} onClick={() => audioClips.remove(node.id, clip.id)}>
                Delete
              </button>
              <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(true)}>
              Delete Named Sound
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** A clip's name that keeps its own text while typed in (an empty or repeated name isn't applied, and the field shows the real one again when left). */
function ClipNameField({ value, onRename }: { value: string; onRename: (name: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (document.activeElement?.getAttribute("aria-label") !== "Named sound's name") setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      aria-label="Named sound's name"
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() !== "") onRename(event.target.value);
      }}
      onBlur={() => setDraft(value)}
      className={inputClasses}
    />
  );
}
