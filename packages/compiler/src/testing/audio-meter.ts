import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test support: run a ROM in melonDS and record how loud its audio output is over time, using
 * tools/ds-toolchain/measure-melonds-audio.ps1 (Windows only; it reads melonDS's own audio-session peak meter, so
 * other programs' sound doesn't matter, and needs a sound output device).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MEASURE_SCRIPT = resolve(HERE, "..", "..", "..", "..", "tools", "ds-toolchain", "measure-melonds-audio.ps1");

/** Peak levels below this count as silence: the meter of an idle stream reads exactly 0, a playing tone about 0.25. */
export const SILENCE = 0.01;

export interface AudioTrace {
  /** [milliseconds since the emulator was launched, peak level 0..1] */
  samples: Array<[number, number]>;
  everSawSession: boolean;
}

export function measureRomAudio(romPath: string, seconds: number): AudioTrace {
  const run = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", MEASURE_SCRIPT, "-Rom", romPath, "-Seconds", String(seconds)],
    { encoding: "utf-8", timeout: (seconds + 60) * 1000 }
  );
  if (run.status !== 0) throw new Error(`Measuring the emulator's audio failed:\n${run.stdout}\n${run.stderr}`);
  const json = run.stdout.trim().split("\n").pop() ?? "";
  return JSON.parse(json.replace(/^﻿/, "")) as AudioTrace;
}

export interface AudioSummary {
  /** When sound first rose above silence, in ms since launch; null if it never did. */
  onsetMs: number | null;
  /** When sound was last above silence; null if it never was. */
  lastSoundMs: number | null;
  /** How long from the first to the last sample above silence, in seconds (0 when there was none). */
  soundSeconds: number;
  /** The median peak while sound was on (the middle of it, without the first and last 200 ms); 0 when there was none. */
  level: number;
  /** The loudest peak seen anywhere. */
  maxPeak: number;
  /** The fraction of samples between onset and the end of the trace that were above silence. */
  soundFractionAfterOnset: number;
}

export function summarizeAudio(trace: AudioTrace): AudioSummary {
  const loud = trace.samples.filter(([, peak]) => peak > SILENCE);
  const maxPeak = trace.samples.reduce((max, [, peak]) => Math.max(max, peak), 0);
  if (loud.length === 0) return { onsetMs: null, lastSoundMs: null, soundSeconds: 0, level: 0, maxPeak, soundFractionAfterOnset: 0 };
  const onsetMs = loud[0][0];
  const lastSoundMs = loud[loud.length - 1][0];
  const middle = loud.filter(([t]) => t >= onsetMs + 200 && t <= lastSoundMs - 200).map(([, peak]) => peak).sort((a, b) => a - b);
  const pool = middle.length > 0 ? middle : loud.map(([, peak]) => peak).sort((a, b) => a - b);
  const after = trace.samples.filter(([t]) => t >= onsetMs);
  return {
    onsetMs,
    lastSoundMs,
    soundSeconds: (lastSoundMs - onsetMs) / 1000,
    level: pool[Math.floor(pool.length / 2)],
    maxPeak,
    soundFractionAfterOnset: after.filter(([, peak]) => peak > SILENCE).length / after.length
  };
}
