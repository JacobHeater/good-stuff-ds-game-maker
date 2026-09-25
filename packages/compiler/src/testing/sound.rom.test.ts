import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DS_HARDWARE_PROFILE, type ProjectSnapshot } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { audioPlayerNode, soundProbeProject, toneSound } from "../fixtures";
import { measureRomAudio, summarizeAudio, type AudioSummary } from "./audio-meter";

/**
 * Sound in a real ROM, measured on melonDS's own audio output (see audio-meter.ts). A ROM can't be listened to by a test, but
 * the emulator's audio session has a peak meter, which is enough to tell whether a sound plays, how loud it is and when it
 * stops. Pitch has no direct reading; a sound that isn't looping lasts 1 / pitch as long, which does. These tests need the
 * toolchain, melonDS and a sound output device, so they run with `pnpm test:rom`.
 *
 * The tone is a 440 Hz sine of amplitude 0.5; the emulator reads it at about 0.25 (`FULL`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const FULL = 0.25;

describe.skipIf(!toolchain.found)("audio players in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-sound-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(name: string, project: ProjectSnapshot, seconds: number): Promise<AudioSummary> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    const trace = measureRomAudio(rom, seconds);
    expect(trace.everSawSession || Math.max(...trace.samples.map(([, p]) => p)) === 0).toBe(true);
    const summary = summarizeAudio(trace);
    console.info(
      `[audio] ${name}: onset ${summary.onsetMs ?? "none"} ms, ${summary.soundSeconds.toFixed(2)} s of sound, level ${summary.level.toFixed(4)}, max ${summary.maxPeak.toFixed(4)}`
    );
    return summary;
  }
  const player = (settings: Parameters<typeof audioPlayerNode>[1]) => audioPlayerNode("Tone", { soundId: "tone", ...settings });
  const tone = (seconds: number, sampleRate = 16000) => toneSound("tone", { sampleRate, seconds });

  it("plays an autoplay sound: it starts within a few seconds of launch, at the tone's level", async () => {
    const heard = await run("autoplay", soundProbeProject([player({})], [tone(2)]), 7);
    expect(heard.onsetMs, "no sound was heard").not.toBeNull();
    expect(heard.onsetMs!).toBeLessThan(4000);
    expect(heard.level).toBeGreaterThan(FULL * 0.8);
    expect(heard.level).toBeLessThan(FULL * 1.2);
  }, 120_000);

  it("is silent when Autoplay is off, even for a looping sound that would otherwise never stop", async () => {
    const heard = await run("no-autoplay", soundProbeProject([player({ autoplay: false, loop: true })], [tone(2)]), 6);
    expect(heard.onsetMs).toBeNull();
    expect(heard.maxPeak).toBeLessThan(0.005);
  }, 120_000);

  it("is silent when there is no audio player at all", async () => {
    const heard = await run("no-player", soundProbeProject([], []), 5);
    expect(heard.maxPeak).toBeLessThan(0.005);
  }, 120_000);

  it("plays at the player's volume: 50% is half as loud as 100%, 25% a quarter, 0% silent", async () => {
    const full = await run("volume-100", soundProbeProject([player({ loop: true })], [tone(1)]), 6);
    const half = await run("volume-50", soundProbeProject([player({ loop: true, volume: 0.5 })], [tone(1)]), 6);
    const quarter = await run("volume-25", soundProbeProject([player({ loop: true, volume: 0.25 })], [tone(1)]), 6);
    const none = await run("volume-0", soundProbeProject([player({ loop: true, volume: 0 })], [tone(1)]), 6);
    expect(full.level).toBeGreaterThan(FULL * 0.8);
    expect(half.level / full.level).toBeGreaterThan(0.42);
    expect(half.level / full.level).toBeLessThan(0.58);
    expect(quarter.level / full.level).toBeGreaterThan(0.18);
    expect(quarter.level / full.level).toBeLessThan(0.32);
    expect(none.maxPeak).toBeLessThan(0.005);
  }, 240_000);

  it("plays a sound that isn't looping once, for its length, then stops", async () => {
    const heard = await run("once", soundProbeProject([player({})], [tone(2)]), 8);
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.soundSeconds).toBeGreaterThan(1.75);
    expect(heard.soundSeconds).toBeLessThan(2.25);
    expect(heard.lastSoundMs!).toBeLessThan(6000); // and it really did stop before the recording ended
  }, 120_000);

  it("plays at the player's pitch: 2x pitch takes half as long, 0.5x twice as long", async () => {
    const double = await run("pitch-2", soundProbeProject([player({ pitch: 2 })], [tone(2)]), 7);
    const half = await run("pitch-half", soundProbeProject([player({ pitch: 0.5 })], [tone(2)]), 9);
    expect(double.soundSeconds).toBeGreaterThan(0.8);
    expect(double.soundSeconds).toBeLessThan(1.25);
    expect(half.soundSeconds).toBeGreaterThan(3.7);
    expect(half.soundSeconds).toBeLessThan(4.3);
  }, 240_000);

  it("loops: a looping 1-second sound is still sounding, without gaps, long after its length", async () => {
    const heard = await run("loop", soundProbeProject([player({ loop: true })], [tone(1)]), 8);
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.lastSoundMs! - heard.onsetMs!).toBeGreaterThan(5000);
    expect(heard.soundFractionAfterOnset).toBeGreaterThan(0.97);
  }, 120_000);

  it("plays several players at once, each with its own sound and settings (louder than one)", async () => {
    const one = await run("one-player", soundProbeProject([player({ loop: true, volume: 0.5 })], [tone(1)]), 6);
    const two = await run(
      "two-players",
      soundProbeProject([player({ loop: true, volume: 0.5 }), audioPlayerNode("Second", { soundId: "tone", loop: true, volume: 0.5 })], [tone(1)]),
      6
    );
    expect(two.level / one.level).toBeGreaterThan(1.6); // the same tone twice, in phase: about double
  }, 180_000);

  it("plays the largest sound the budget allows (nearly 2 MB) alongside the 3D scene", async () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    const rate = 32000;
    const seconds = Math.floor((limit / 2 - 32000) / rate); // just under the limit
    const heard = await run("large", soundProbeProject([player({})], [tone(seconds, rate)]), 7);
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.level).toBeGreaterThan(FULL * 0.8);
    expect(heard.soundFractionAfterOnset).toBeGreaterThan(0.95); // 30 seconds long: still going at the end of the recording
  }, 240_000);
});
