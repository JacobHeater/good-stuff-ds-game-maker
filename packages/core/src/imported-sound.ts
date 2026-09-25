import { DS_HARDWARE_PROFILE } from "./hardware";
import { base64ToBytes, bytesToBase64 } from "./imported-texture";

/**
 * A sound in a project, stored already converted to what the DS plays (requirements/audio/TASK.sound-import-conversion.md):
 * mono, 16-bit, at a sample rate the DS can use. Like textures, it is embedded in the project file, so nothing depends on
 * the original file staying put and the editor previews exactly what the ROM plays.
 *
 * `samples` is base64 of little-endian signed 16-bit values, one per sample.
 */
export interface ImportedSound {
  id: string;
  /** What the user calls it; the file's name without its extension. */
  name: string;
  /** Samples per second. */
  sampleRate: number;
  samples: string;
}

/** The DS mixes at about 32 kHz, so a higher rate only costs memory. */
export const MAX_SOUND_SAMPLE_RATE = 32000;
/** A sound too big for the sound budget is resampled down to fit, but never below this (about 131 s of sound fit in 2 MB at it). */
export const MIN_FITTED_SAMPLE_RATE = 8000;
/** The lowest rate the editor's decoder will produce; below this a file is decoded at this rate and so is a little bigger. */
export const MIN_SOUND_SAMPLE_RATE = 3000;
/** File extensions the import dialog offers. The editor's own decoder handles them. */
export const SOUND_FILE_EXTENSIONS = ["wav", "mp3", "ogg"] as const;

export function isSoundSampleRate(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SOUND_SAMPLE_RATE && value <= MAX_SOUND_SAMPLE_RATE;
}

/** How much of the DS's memory a sound takes: two bytes a sample. */
export function getSoundByteSize(sound: { samples: string }): number {
  return getSoundSampleCount(sound) * 2;
}

/** The number of samples, read from the base64 text's length without decoding it. */
export function getSoundSampleCount(sound: { samples: string }): number {
  const text = sound.samples;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.floor(((text.length / 4) * 3 - padding) / 2);
}

export function getSoundDurationSeconds(sound: { sampleRate: number; samples: string }): number {
  return getSoundSampleCount(sound) / sound.sampleRate;
}

/** `m:ss`, for the audio player's time display. */
export function formatSoundTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function encodeSamples(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
  return bytesToBase64(bytes);
}

const decoded = new WeakMap<ImportedSound, Int16Array>();

/** The sound's samples. Decoded once per sound object and shared; do not mutate it. */
export function getSoundSamples(sound: ImportedSound): Int16Array {
  let samples = decoded.get(sound);
  if (!samples) {
    const bytes = base64ToBytes(sound.samples);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    samples = new Int16Array(bytes.length >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
    decoded.set(sound, samples);
  }
  return samples;
}

export type SoundImportResult =
  | { ok: true; sound: Omit<ImportedSound, "id">; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Turns decoded audio (one array of -1..1 samples per channel) into a DS sound, or refuses it with reasons. Pure: the caller
 * decodes the file (the editor window does). Mixes to mono, resamples down to at most `MAX_SOUND_SAMPLE_RATE` (never up),
 * rounds to 16 bits (clipping what is out of range) and refuses what won't fit in the sound budget.
 *
 * `sourceSampleRate` is the rate of the file itself when the decoder already resampled it to `sampleRate` (the browser's decoder
 * does), so the warning can still say what happened.
 */
export function createSoundFromPcm(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
  options: { name: string; sourceSampleRate?: number }
): SoundImportResult {
  if (channels.length === 0 || channels[0].length === 0) return { ok: false, errors: ["The file has no audio in it."] };
  if (channels.some((channel) => channel.length !== channels[0].length)) {
    return { ok: false, errors: ["The file's audio channels are different lengths."] };
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return { ok: false, errors: ["The file's sample rate isn't a positive number."] };

  const warnings: string[] = [];
  const length = channels[0].length;

  // Mono: the average of the channels.
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    mono[i] = sum / channels.length;
  }
  if (channels.length > 1) warnings.push(`It has ${channels.length} channels; the DS plays one, so they were mixed together.`);

  // Rate: down to the DS's limit, never up.
  let samples: Float32Array = mono;
  let rate = sampleRate;
  if (sampleRate > MAX_SOUND_SAMPLE_RATE) {
    samples = resampleDown(mono, sampleRate, MAX_SOUND_SAMPLE_RATE);
    rate = MAX_SOUND_SAMPLE_RATE;
  }
  const originalRate = options.sourceSampleRate ?? sampleRate;
  if (originalRate > MAX_SOUND_SAMPLE_RATE) {
    warnings.push(`It is ${Math.round(originalRate)} Hz; the DS plays up to about ${MAX_SOUND_SAMPLE_RATE} Hz, so it was resampled to ${MAX_SOUND_SAMPLE_RATE} Hz.`);
  }
  rate = Math.round(rate);
  if (samples.length === 0) return { ok: false, errors: ["The file has no audio in it."] };

  // Fit: a sound over the sound budget is compressed more, by resampling it to the highest rate at which it fits, rather than
  // refused. Only one that would still be too long at the lowest rate we'll go to is refused.
  const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
  const limitSamples = limit / 2;
  if (samples.length > limitSamples) {
    const seconds = samples.length / rate;
    const fitRate = Math.floor((limitSamples * rate) / samples.length);
    if (fitRate < MIN_FITTED_SAMPLE_RATE) {
      const longest = Math.floor(limitSamples / MIN_FITTED_SAMPLE_RATE);
      return {
        ok: false,
        errors: [
          `The sound is ${seconds.toFixed(1)} seconds long. The DS has ${limit / 1024 / 1024} MB for all of a game's sounds, which holds at most ${longest} seconds even at ${MIN_FITTED_SAMPLE_RATE} Hz, the lowest quality import will go to. Use a shorter sound.`
        ]
      };
    }
    samples = resampleDown(samples, rate, fitRate);
    warnings.push(
      `It is ${seconds.toFixed(1)} seconds long, more than the DS's ${limit / 1024 / 1024} MB of sound memory holds at ${rate} Hz, so it was resampled to ${fitRate} Hz to fit. It will sound duller.`
    );
    rate = fitRate;
  }

  // 16 bits.
  const pcm = new Int16Array(samples.length);
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value > 1 || value < -1) clipped++;
    pcm[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  }
  if (clipped > 0) warnings.push(`${clipped} sample${clipped === 1 ? " was" : "s were"} louder than the DS can play and ${clipped === 1 ? "was" : "were"} clipped.`);

  return { ok: true, sound: { name: options.name.trim() || "Sound", sampleRate: rate, samples: encodeSamples(pcm) }, warnings };
}

/**
 * Resamples to a lower rate by averaging the source samples each output sample covers (a box filter, weighted at the edges),
 * which keeps high frequencies from folding back down as noise.
 */
function resampleDown(source: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(source.length / ratio));
  const out = new Float32Array(outLength);
  for (let j = 0; j < outLength; j++) {
    const start = j * ratio;
    const end = Math.min(source.length, start + ratio);
    let sum = 0;
    let weight = 0;
    for (let i = Math.floor(start); i < end; i++) {
      const overlap = Math.min(i + 1, end) - Math.max(i, start);
      sum += source[i] * overlap;
      weight += overlap;
    }
    out[j] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

const MP3_SAMPLE_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * The sample rate stored in a WAV, MP3 or Ogg Vorbis file's header, or null when it can't be found. Used to ask the decoder for
 * `min(file rate, 32000)`, so a 22 kHz file isn't decoded at 32 kHz and doubled in size for nothing.
 */
export function sniffSoundSampleRate(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, text: string): boolean => {
    if (offset + text.length > bytes.length) return false;
    for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    return true;
  };

  if (ascii(0, "RIFF") && ascii(8, "WAVE")) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset + 4, true);
      if (ascii(offset, "fmt ")) return offset + 16 <= bytes.length ? view.getUint32(offset + 12, true) : null;
      offset += 8 + size + (size % 2);
    }
    return null;
  }

  if (ascii(0, "OggS")) {
    const limit = Math.min(bytes.length - 15, 512); // the rate is four bytes at i + 12
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 1 && ascii(i + 1, "vorbis")) return view.getUint32(i + 12, true);
    }
    return null;
  }

  // MP3: skip an ID3v2 tag, then find the first frame header.
  let start = 0;
  if (ascii(0, "ID3") && bytes.length >= 10) {
    start = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f);
  }
  const end = Math.min(bytes.length - 4, start + 65536);
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1] >> 3) & 3;
    const layer = (bytes[i + 1] >> 1) & 3;
    const bitrate = (bytes[i + 2] >> 4) & 15;
    const rateIndex = (bytes[i + 2] >> 2) & 3;
    if (version === 1 || layer === 0 || bitrate === 15 || bitrate === 0 || rateIndex === 3) continue;
    return MP3_SAMPLE_RATES[version][rateIndex];
  }
  return null;
}
