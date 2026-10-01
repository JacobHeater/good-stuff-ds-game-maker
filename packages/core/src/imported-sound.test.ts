import { describe, expect, it } from "vitest";

import {
  clampPitch,
  clampVolume,
  DEFAULT_AUDIO_PLAYER,
  dsVolume,
  getAudioPlayer,
  playbackFrequency
} from "./audio-player";
import { computeSceneBudget } from "./budget";
import { DS_HARDWARE_PROFILE } from "./hardware";
import { imaAdpcmByteSize } from "./ima-adpcm";
import {
  compressSoundToAdpcm,
  createSoundFromPcm,
  encodeSamples,
  formatSoundTime,
  getSoundByteSize,
  getSoundDurationSeconds,
  getSoundSampleCount,
  getSoundSamples,
  MAX_SOUND_SAMPLE_RATE,
  rawSoundBytes,
  sniffSoundSampleRate,
  type ImportedSound,
  type SoundFormat
} from "./imported-sound";
import { createProjectSnapshot, withUpdatedScene } from "./project-snapshot";
import { createSceneNode, duplicateSceneNode } from "./scene-node";

function sine(rate: number, seconds: number, hz: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}
// These tests are about the resample/clip/fit math itself, so they pin "pcm16" to keep comparing exact sample values;
// `describe("compressing to ima-adpcm by default", ...)` below covers the new default on its own terms.
const made = (channels: Float32Array[], rate: number, sourceSampleRate?: number) => {
  const result = createSoundFromPcm(channels, rate, { name: "tone", sourceSampleRate, format: "pcm16" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
};
const soundOf = (channels: Float32Array[], rate: number, format: SoundFormat = "pcm16"): ImportedSound => {
  const result = createSoundFromPcm(channels, rate, { name: "tone", format });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { id: "s", ...result.sound };
};

describe("converting decoded audio to a DS sound", () => {
  it("stores a mono sound at a supported rate as it is, rounded to 16 bits, with no warnings", () => {
    const source = sine(22050, 1, 440);
    const result = made([source], 22050);
    expect(result.warnings).toEqual([]);
    expect(result.sound).toMatchObject({ name: "tone", sampleRate: 22050 });
    const stored = getSoundSamples({ id: "x", ...result.sound });
    expect(stored).toHaveLength(22050);
    for (const i of [0, 1, 100, 5000, 22049]) expect(stored[i]).toBe(Math.round(source[i] * 32767));
  });

  it("mixes stereo to mono by averaging, and says so", () => {
    const left = new Float32Array([0.5, 0.25, -0.5]);
    const right = new Float32Array([0.1, -0.25, 0.5]);
    const result = made([left, right], 16000);
    expect(Array.from(getSoundSamples({ id: "x", ...result.sound }))).toEqual([0.3, 0, 0].map((v) => Math.round(v * 32767)));
    expect(result.warnings.join(" ")).toMatch(/2 channels.*mixed together/);
  });

  it("resamples a rate above the DS's down to 32000 Hz, keeping the tone, and says so", () => {
    const result = made([sine(48000, 1, 440)], 48000);
    expect(result.sound.sampleRate).toBe(MAX_SOUND_SAMPLE_RATE);
    expect(result.warnings.join(" ")).toMatch(/48000 Hz.*resampled to 32000 Hz/);
    const stored = getSoundSamples({ id: "x", ...result.sound });
    expect(stored).toHaveLength(32000);
    // Still a 440 Hz sine: compare with one generated at the new rate (the box filter costs a hair of amplitude at 440 Hz).
    const expected = sine(32000, 1, 440);
    let worst = 0;
    for (let i = 100; i < 31900; i++) worst = Math.max(worst, Math.abs(stored[i] / 32767 - expected[i]));
    expect(worst).toBeLessThan(0.02);
  });

  it("never resamples up or below what it was given", () => {
    expect(made([sine(8000, 1, 200)], 8000).sound.sampleRate).toBe(8000);
    expect(made([sine(32000, 1, 200)], 32000).warnings).toEqual([]);
  });

  it("warns about a source rate the decoder already resampled, without resampling again", () => {
    const result = made([sine(32000, 1, 440)], 32000, 44100);
    expect(result.sound.sampleRate).toBe(32000);
    expect(getSoundSampleCount(result.sound)).toBe(32000);
    expect(result.warnings.join(" ")).toMatch(/44100 Hz.*resampled to 32000 Hz/);
  });

  it("clips samples that are out of range and counts them", () => {
    const result = made([new Float32Array([1.5, -2, 0.5, 1])], 16000);
    expect(Array.from(getSoundSamples({ id: "x", ...result.sound }))).toEqual([32767, -32767, Math.round(0.5 * 32767), 32767]);
    expect(result.warnings.join(" ")).toMatch(/2 samples were louder than the DS can play/);
  });

  it("compresses a sound over the memory limit more, to the highest rate that fits, keeping its length and tone", () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    const result = made([sine(32000, 40, 440)], 32000); // 2.44 MB
    expect(result.sound.sampleRate).toBe(26214); // floor(1048576 * 32000 / 1280000)
    expect(getSoundByteSize(result.sound)).toBeLessThanOrEqual(limit);
    expect(getSoundByteSize(result.sound)).toBeGreaterThan(limit * 0.999); // as close to the limit as it can get
    expect(getSoundDurationSeconds(result.sound)).toBeCloseTo(40, 2);
    expect(result.warnings.join(" ")).toMatch(/40\.0 seconds long.*resampled to 26214 Hz to fit\. It will sound duller/);
    // Still a 440 Hz sine.
    const stored = getSoundSamples({ id: "x", ...result.sound });
    const expected = sine(26214, 1, 440);
    let worst = 0;
    for (let i = 100; i < 26000; i++) worst = Math.max(worst, Math.abs(stored[i] / 32767 - expected[i]));
    expect(worst).toBeLessThan(0.02);
  });

  it("fits a long high-rate file in two steps: down to 32 kHz, then further to fit", () => {
    const result = made([sine(48000, 50, 220)], 48000);
    expect(result.sound.sampleRate).toBe(20971);
    expect(getSoundByteSize(result.sound)).toBeLessThanOrEqual(DS_HARDWARE_PROFILE.audio.soundMemoryBytes);
    expect(result.warnings.filter((w) => /resampled/.test(w))).toHaveLength(2);
  });

  it("stores a sound that exactly fills the budget as it is, and one a sample over is compressed", () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    const exact = made([new Float32Array(limit / 2)], 16000);
    expect(exact.sound.sampleRate).toBe(16000);
    expect(exact.warnings).toEqual([]);
    const over = made([new Float32Array(limit / 2 + 1)], 16000);
    expect(over.sound.sampleRate).toBe(15999);
    expect(getSoundByteSize(over.sound)).toBeLessThanOrEqual(limit);
  });

  it("refuses a sound too long even at the lowest rate, giving its length and the longest the DS holds", () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    const result = createSoundFromPcm([new Float32Array(140 * 8000)], 8000, { name: "long", format: "pcm16" }); // 140 s at 8 kHz
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/140\.0 seconds long.*at most 131 seconds even at 8000 Hz/);
    expect(createSoundFromPcm([new Float32Array(limit / 2)], 8000, { name: "just fits", format: "pcm16" }).ok).toBe(true);
    // The floor is 8000 Hz: 131 s at 8 kHz fits as is, and 132 s would need 7 kHz.
    expect(createSoundFromPcm([new Float32Array(131 * 8000)], 8000, { name: "a", format: "pcm16" }).ok).toBe(true);
    expect(createSoundFromPcm([new Float32Array(132 * 8000)], 8000, { name: "b", format: "pcm16" }).ok).toBe(false);
  });

  it("refuses nothing to play, mismatched channels and a bad rate", () => {
    for (const [channels, rate] of [
      [[], 16000],
      [[new Float32Array(0)], 16000],
      [[new Float32Array(4), new Float32Array(5)], 16000],
      [[new Float32Array(4)], 0],
      [[new Float32Array(4)], Number.NaN]
    ] as const) {
      expect(createSoundFromPcm(channels, rate, { name: "x" }).ok).toBe(false);
    }
  });

  it("names a nameless sound 'Sound'", () => {
    expect(createSoundFromPcm([new Float32Array(8)], 8000, { name: "  " })).toMatchObject({ ok: true, sound: { name: "Sound" } });
  });

  it("round-trips the stored samples exactly, and reports size and length from the text", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
    const sound: ImportedSound = { id: "s", name: "n", sampleRate: 8000, samples: encodeSamples(samples) };
    expect(Array.from(getSoundSamples(sound))).toEqual(Array.from(samples));
    expect(getSoundSampleCount(sound)).toBe(7);
    expect(getSoundByteSize(sound)).toBe(14);
    expect(getSoundDurationSeconds(sound)).toBeCloseTo(7 / 8000);
    expect(getSoundSamples(sound)).toBe(getSoundSamples(sound)); // decoded once
  });

  it("formats times as m:ss", () => {
    expect([0, 5.9, 65, 600].map(formatSoundTime)).toEqual(["0:00", "0:05", "1:05", "10:00"]);
  });
});

describe("compressing to ima-adpcm by default (requirements/audio/STORY.compressed-sound.md)", () => {
  it("is the default when a format isn't asked for, with a sampleCount since the byte length alone can't say it exactly", () => {
    const result = createSoundFromPcm([sine(16000, 1, 440)], 16000, { name: "tone" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.sound.format).toBe("ima-adpcm");
    expect(result.sound.sampleCount).toBe(16000);
    expect(getSoundByteSize(result.sound)).toBe(imaAdpcmByteSize(16000));
  });

  it("is about a quarter the size of pcm16 at the same rate, give or take the header", () => {
    const adpcm = createSoundFromPcm([sine(16000, 2, 440)], 16000, { name: "tone", format: "ima-adpcm" });
    const pcm16 = createSoundFromPcm([sine(16000, 2, 440)], 16000, { name: "tone", format: "pcm16" });
    if (!adpcm.ok || !pcm16.ok) throw new Error("expected both to succeed");
    expect(getSoundByteSize(adpcm.sound)).toBeLessThan(getSoundByteSize(pcm16.sound) / 3.5);
  });

  it("round-trips a tone closely, though lossily (unlike pcm16's exact round trip)", () => {
    const source = sine(16000, 0.5, 440);
    const sound = soundOf([source], 16000, "ima-adpcm");
    const stored = getSoundSamples(sound);
    expect(stored).toHaveLength(source.length);
    let worst = 0;
    for (let i = 100; i < source.length - 100; i++) worst = Math.max(worst, Math.abs(stored[i] / 32767 - source[i]));
    expect(worst).toBeLessThan(0.05);
  });

  it("embeds the exact encoded bytes (what the compiler puts in the ROM), not the decoded samples", () => {
    const sound = soundOf([sine(8000, 0.1, 440)], 8000, "ima-adpcm");
    expect(rawSoundBytes(sound)).toHaveLength(imaAdpcmByteSize(sound.sampleCount!));
  });

  it("fits far more into the sound budget than pcm16 would, since each sample is a nibble instead of two bytes", () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    // At 32 kHz this is 3.84 MB of pcm16 (over budget) but well under a quarter of that as ima-adpcm.
    const result = createSoundFromPcm([sine(32000, 60, 440)], 32000, { name: "long" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.sound.sampleRate).toBe(32000); // not resampled down to fit, unlike the pcm16 case above
    expect(result.warnings).toEqual([]);
    expect(getSoundByteSize(result.sound)).toBeLessThan(limit);
  });
});

describe("compressing a sound already in the project (no original file needed)", () => {
  it("re-encodes a pcm16 sound to ima-adpcm in place, to about a quarter the size, keeping id/name/rate", () => {
    const pcm: ImportedSound = { id: "s1", name: "Song", sampleRate: 16000, samples: encodeSamples(new Int16Array(16000)) }; // 1s, 32000 bytes
    const compressed = compressSoundToAdpcm(pcm);
    expect(compressed).toMatchObject({ id: "s1", name: "Song", sampleRate: 16000, format: "ima-adpcm", sampleCount: 16000 });
    expect(getSoundByteSize(compressed)).toBeLessThan(getSoundByteSize(pcm) / 3.5);
  });

  it("keeps the same decoded tone, lossily", () => {
    const source = sine(16000, 0.5, 440);
    const pcm: ImportedSound = { id: "s", name: "n", sampleRate: 16000, samples: encodeSamples(new Int16Array(Array.from(source, (v) => Math.round(v * 32767)))) };
    const compressed = compressSoundToAdpcm(pcm);
    const before = getSoundSamples(pcm);
    const after = getSoundSamples(compressed);
    expect(after).toHaveLength(before.length);
    let worst = 0;
    for (let i = 100; i < before.length - 100; i++) worst = Math.max(worst, Math.abs(after[i] / 32767 - before[i] / 32767));
    expect(worst).toBeLessThan(0.05);
  });

  it("leaves an already-compressed sound alone instead of re-encoding it again", () => {
    const already: ImportedSound = { id: "s", name: "n", sampleRate: 8000, format: "ima-adpcm", sampleCount: 4, samples: "AAAAAA==" };
    expect(compressSoundToAdpcm(already)).toBe(already);
  });
});

describe("reading a sample rate from a file header", () => {
  const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

  it("reads a WAV's fmt chunk, even after another chunk", () => {
    const fmt = [...text("fmt "), ...u32(16), 1, 0, 2, 0, ...u32(44100), ...u32(176400), 4, 0, 16, 0];
    const junk = [...text("LIST"), ...u32(3), 1, 2, 3, 0]; // odd size, padded
    const wav = new Uint8Array([...text("RIFF"), ...u32(100), ...text("WAVE"), ...junk, ...fmt]);
    expect(sniffSoundSampleRate(wav)).toBe(44100);
    expect(sniffSoundSampleRate(new Uint8Array([...text("RIFF"), ...u32(100), ...text("WAVE"), ...fmt]))).toBe(44100);
  });

  it("reads an Ogg Vorbis identification header", () => {
    const ogg = new Uint8Array([...text("OggS"), 0, 2, ...new Array(20).fill(0), 30, 1, ...text("vorbis"), ...u32(0), 2, ...u32(22050)]);
    expect(sniffSoundSampleRate(ogg)).toBe(22050);
  });

  it("reads an MP3 frame header, skipping an ID3 tag", () => {
    // MPEG1 Layer III, 128 kbps, index 1 = 48000 Hz -> FF FB 94 ..
    const frame = [0xff, 0xfb, 0x94, 0x00];
    expect(sniffSoundSampleRate(new Uint8Array([...frame, 0, 0, 0, 0]))).toBe(48000);
    // MPEG2 Layer III, 64 kbps, index 0 = 22050 Hz -> FF F3 80
    expect(sniffSoundSampleRate(new Uint8Array([0xff, 0xf3, 0x80, 0x00, 0, 0]))).toBe(22050);
    // An ID3v2 tag of 10 bytes (syncsafe size 10) containing what looks like a false sync, then the real frame.
    const tag = [...text("ID3"), 3, 0, 0, 0, 0, 0, 10, 0xff, 0xfb, 0xf4, 0, 0, 0, 0, 0, 0, 0];
    expect(sniffSoundSampleRate(new Uint8Array([...tag, 0xff, 0xfb, 0x90, 0x00, 0, 0]))).toBe(44100);
  });

  it("returns null for anything else", () => {
    expect(sniffSoundSampleRate(new Uint8Array(0))).toBeNull();
    expect(sniffSoundSampleRate(new Uint8Array(text("not audio at all, just words")))).toBeNull();
    expect(sniffSoundSampleRate(new Uint8Array([...text("RIFF"), ...u32(4), ...text("WAVE")]))).toBeNull();
  });
});

describe("an audio player's settings", () => {
  it("has defaults when nothing is saved: autoplay on, full volume, normal pitch, no loop, no sound", () => {
    expect(getAudioPlayer({})).toEqual({ autoplay: true, volume: 1, pitch: 1, loop: false });
    expect(DEFAULT_AUDIO_PLAYER).toEqual({ autoplay: true, volume: 1, pitch: 1, loop: false });
    expect(getAudioPlayer({ audio: { soundId: "s", autoplay: false, volume: 0.4, pitch: 1.5, loop: true } })).toEqual({
      soundId: "s",
      autoplay: false,
      volume: 0.4,
      pitch: 1.5,
      loop: true
    });
    expect(getAudioPlayer({ audio: { autoplay: false } as never })).toMatchObject({ autoplay: false, volume: 1 });
  });

  it("maps volume to the DS's 0-127 and clamps", () => {
    expect([0, 0.5, 1, 2, -1].map(dsVolume)).toEqual([0, 64, 127, 127, 0]);
    expect([clampVolume(3), clampVolume(-3), clampVolume(0.3)]).toEqual([1, 0, 0.3]);
    expect([clampPitch(0), clampPitch(10), clampPitch(1.5)]).toEqual([0.25, 4, 1.5]);
  });

  it("plays at the sample rate times the pitch, limited to what the hardware takes", () => {
    expect(playbackFrequency(22050, 1)).toEqual({ hz: 22050, clamped: false });
    expect(playbackFrequency(22050, 2)).toEqual({ hz: 44100, clamped: false });
    expect(playbackFrequency(32000, 4)).toEqual({ hz: 65535, clamped: true });
    expect(playbackFrequency(3000, 0.25)).toEqual({ hz: 750, clamped: false });
  });
});

describe("sounds in the project", () => {
  const tone = soundOf([sine(8000, 0.25, 440)], 8000); // 2000 samples = 4000 bytes
  const other = soundOf([sine(8000, 0.5, 220)], 8000); // 4000 samples = 8000 bytes
  const player = (name: string, soundId?: string) => {
    const node = createSceneNode({ name, kind: "AudioStreamPlayer" });
    if (soundId) node.audio = { soundId, autoplay: true, volume: 1, pitch: 1, loop: false };
    return node;
  };

  it("counts each distinct sound once in the budget", () => {
    const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [player("A", "s"), player("B", "s"), player("C", "o"), player("D")] });
    const budget = computeSceneBudget(scene, undefined, undefined, [tone, { ...other, id: "o" }, { ...tone, id: "unused" }]);
    expect(budget.soundBytesUsed).toBe(4000 + 8000);
    expect(budget.soundBytesLimit).toBe(2 * 1024 * 1024);
    expect(budget.audioPlayersUsed).toBe(4);
    expect(computeSceneBudget(scene).soundBytesUsed).toBe(0);
  });

  it("saves a shared sound once and drops one nothing uses", () => {
    const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [player("A", "s"), player("B", "s")] });
    const project = { ...createProjectSnapshot({ name: "P", mode: "3D", scene }), sounds: [tone, { ...other, id: "unused" }] };
    expect(withUpdatedScene(project, scene).sounds).toEqual([tone]);
    const empty = createSceneNode({ name: "Main", kind: "Node3D", children: [player("A")] });
    expect("sounds" in withUpdatedScene(project, empty)).toBe(false);
  });

  it("copies a duplicated player's settings and shares its sound", () => {
    const original = player("A", "s");
    original.audio = { soundId: "s", autoplay: false, volume: 0.4, pitch: 1.5, loop: true };
    const copy = duplicateSceneNode(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.audio).toEqual(original.audio);
  });
});
