import { createSoundFromPcm, MAX_SOUND_SAMPLE_RATE, MIN_SOUND_SAMPLE_RATE, sniffSoundSampleRate, type SoundImportResult } from "@goodstuff/core";

/**
 * Decodes a WAV, MP3 or OGG file with the editor window's own audio decoder and converts it to a DS sound
 * (requirements/audio/TASK.sound-import-conversion.md). The decoder resamples to the rate of the context it is given, so the
 * rate is chosen from the file's header: the file's own rate when that is one the DS plays, otherwise the DS's maximum.
 * A 22 kHz file is therefore not upsampled and doubled in size, and a 44.1 kHz one is brought down by the browser's resampler.
 * The conversion rules themselves (mono, 16 bits, size limit, warnings) are core's `createSoundFromPcm`, which is unit-tested.
 */
export async function decodeSoundFile(bytes: Uint8Array, fileName: string): Promise<SoundImportResult> {
  const name = fileName.replace(/\.[^.]+$/, "");
  const sourceRate = sniffSoundSampleRate(bytes);
  const rate = Math.min(MAX_SOUND_SAMPLE_RATE, Math.max(MIN_SOUND_SAMPLE_RATE, sourceRate ?? MAX_SOUND_SAMPLE_RATE));

  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, rate);
    // decodeAudioData takes ownership of the buffer it is given, so it gets a copy.
    decoded = await context.decodeAudioData(bytes.slice().buffer);
  } catch (error) {
    const reason = error instanceof Error && error.message ? ` (${error.message})` : "";
    return { ok: false, errors: [`"${fileName}" isn't audio the editor can read${reason}. WAV, MP3 and OGG files are supported.`] };
  }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
  return createSoundFromPcm(channels, decoded.sampleRate, { name, ...(sourceRate !== null ? { sourceSampleRate: sourceRate } : {}) });
}
