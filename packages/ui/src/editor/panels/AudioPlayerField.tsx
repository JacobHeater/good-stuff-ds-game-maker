import {
  dsVolume,
  formatSoundTime,
  getAudioPlayer,
  getSoundByteSize,
  getSoundDurationSeconds,
  PITCH_MAX,
  PITCH_MIN,
  playbackFrequency,
  type ImportedSound,
  type SceneNode
} from "@goodstuff/core";

import { useSoundPreview } from "../audio/sound-preview";
import type { AudioPlayerChange } from "../state/editor-store";
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
      {sound && <div className="text-[10px] text-editor-text-muted">{getSoundByteSize(sound)} bytes of the DS's sound memory.</div>}

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
    </div>
  );
}
