import { useEffect, useRef, useState } from "react";
import { dsVolume, getSoundDurationSeconds, getSoundSamples, playbackFrequency, type ImportedSound } from "@goodstuff/core";

/**
 * The editor's preview of a sound (requirements/audio/STORY.import-sound-and-audio-player.md): plays the sound as stored, so
 * it has already been through the DS conversion, with the same volume and playback rate the ROM will use. Volume is the DS's
 * level (`round(127 * volume)` out of 127) and the rate is `playbackFrequency`, limited to what the DS's hardware takes,
 * so what is heard here is what the ROM plays.
 */

export interface PreviewSettings {
  /** 0..1 */
  volume: number;
  /** The pitch multiplier, 0.25..4. */
  pitch: number;
  loop: boolean;
}

export interface PreviewView {
  playing: boolean;
  /** Seconds into the sound. 0 when stopped. */
  position: number;
}

let sharedContext: AudioContext | null = null;
function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

const buffers = new WeakMap<ImportedSound, AudioBuffer>();
function bufferFor(context: AudioContext, sound: ImportedSound): AudioBuffer {
  let buffer = buffers.get(sound);
  if (!buffer) {
    const samples = getSoundSamples(sound);
    buffer = context.createBuffer(1, samples.length, sound.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    buffers.set(sound, buffer);
  }
  return buffer;
}

const rateFor = (sound: ImportedSound, settings: PreviewSettings): number => playbackFrequency(sound.sampleRate, settings.pitch).hz / sound.sampleRate;
const gainFor = (settings: PreviewSettings): number => dsVolume(settings.volume) / 127;

/** One sound's playback. Not React: `useSoundPreview` wraps it. */
export class SoundPreview {
  private readonly duration: number;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private playing = false;
  /** Seconds into the sound; while playing it is advanced from the audio clock by `advance`. */
  private offset = 0;
  private lastClock = 0;
  private frame = 0;
  private listeners = new Set<(view: PreviewView) => void>();

  constructor(
    private readonly sound: ImportedSound,
    private settings: PreviewSettings
  ) {
    this.duration = getSoundDurationSeconds(sound);
  }

  subscribe(listener: (view: PreviewView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): PreviewView {
    return { playing: this.playing, position: this.playing || this.offset > 0 ? Math.min(this.offset, this.duration) : 0 };
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const context = audioContext();
    if (context.state === "suspended") await context.resume();
    if (this.offset >= this.duration) this.offset = 0;
    this.startSource(context);
    this.playing = true;
    this.lastClock = context.currentTime;
    this.loop();
    this.emit();
  }

  stop(): void {
    this.silence();
    this.offset = 0;
    this.emit();
  }

  /** Jumps to `seconds` into the sound, keeping playing or stopped as it is. */
  seek(seconds: number): void {
    this.offset = Math.min(Math.max(0, seconds), Math.max(0, this.duration - 0.001));
    if (this.playing) {
      const context = audioContext();
      this.startSource(context);
      this.lastClock = context.currentTime;
    }
    this.emit();
  }

  /** New settings apply at once, without restarting the sound. */
  update(settings: PreviewSettings): void {
    if (this.playing) this.advance(); // account for the time played at the old rate first
    this.settings = settings;
    if (this.source && this.gain) {
      const now = audioContext().currentTime;
      this.source.loop = settings.loop;
      this.source.playbackRate.setValueAtTime(rateFor(this.sound, settings), now);
      this.gain.gain.setValueAtTime(gainFor(settings), now);
    }
  }

  dispose(): void {
    this.silence();
    this.listeners.clear();
  }

  private startSource(context: AudioContext): void {
    this.detachSource();
    const source = context.createBufferSource();
    source.buffer = bufferFor(context, this.sound);
    source.loop = this.settings.loop;
    source.playbackRate.value = rateFor(this.sound, this.settings);
    const gain = context.createGain();
    gain.gain.value = gainFor(this.settings);
    source.connect(gain).connect(context.destination);
    // A sound that isn't looping ends by itself: this is what turns Stop back into Play.
    source.onended = () => {
      if (this.source === source && !source.loop) this.stop();
    };
    source.start(0, this.offset);
    this.source = source;
    this.gain = gain;
  }

  private detachSource(): void {
    if (!this.source) return;
    this.source.onended = null;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  private silence(): void {
    this.detachSource();
    this.playing = false;
    cancelAnimationFrame(this.frame);
  }

  /** Moves the position on by the time played since the last look, at the current rate. */
  private advance(): void {
    const now = audioContext().currentTime;
    this.offset += (now - this.lastClock) * rateFor(this.sound, this.settings);
    this.lastClock = now;
    if (this.settings.loop && this.duration > 0) this.offset %= this.duration;
  }

  private loop = (): void => {
    if (!this.playing) return;
    this.advance();
    this.emit();
    this.frame = requestAnimationFrame(this.loop);
  };

  private emit(): void {
    const view = this.snapshot();
    for (const listener of this.listeners) listener(view);
  }
}

const IDLE: PreviewView = { playing: false, position: 0 };

/**
 * Previews `sound` with `settings`. The preview stops when the sound changes or the component goes away, and follows setting
 * changes while it plays.
 */
export function useSoundPreview(
  sound: ImportedSound | undefined,
  settings: PreviewSettings
): PreviewView & { duration: number; play: () => void; stop: () => void; seek: (seconds: number) => void } {
  const preview = useRef<SoundPreview | null>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const [view, setView] = useState<PreviewView>(IDLE);

  useEffect(() => {
    if (!sound) {
      setView(IDLE);
      return undefined;
    }
    const created = new SoundPreview(sound, latest.current);
    preview.current = created;
    const unsubscribe = created.subscribe(setView);
    setView(created.snapshot());
    return () => {
      unsubscribe();
      created.dispose();
      preview.current = null;
    };
  }, [sound]);

  useEffect(() => {
    preview.current?.update({ volume: settings.volume, pitch: settings.pitch, loop: settings.loop });
  }, [settings.volume, settings.pitch, settings.loop]);

  return {
    ...view,
    duration: sound ? getSoundDurationSeconds(sound) : 0,
    play: () => void preview.current?.play(),
    stop: () => preview.current?.stop(),
    seek: (seconds) => preview.current?.seek(seconds)
  };
}
