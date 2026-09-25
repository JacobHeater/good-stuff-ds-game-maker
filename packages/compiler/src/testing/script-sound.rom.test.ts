import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { audioPlayerNode, scriptedProject, toneSound } from "../fixtures";
import { measureRomAudio, summarizeAudio, type AudioSummary } from "./audio-meter";

/**
 * Sound started, stopped and changed by scripts, measured on melonDS's own audio output (see audio-meter.ts). A sound player with Autoplay off is
 * silent (sound.rom.test.ts); here a script starts it. Volume and pitch are checked the way the player's settings are: 50% volume reads half the
 * level, and 2x pitch makes a sound that isn't looping last half as long.
 *
 * Requirements: requirements/scripting/STORY.write-and-run-scripts.md ("Scripts play sounds"), compiler/TASK.runtime-node-table-and-script-services.md.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
/** What a 0.5-amplitude tone reads at full volume on melonDS. */
const FULL = 0.25;

describe.skipIf(!toolchain.found)("scripts control sound in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-script-sound-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  /** A scene with a silent sound player (Autoplay off, looping if asked) and a script, either on the player or on the cube. */
  async function run(name: string, source: string, options: { loop?: boolean; seconds?: number; onPlayer?: boolean; playerVolume?: number; listen?: number } = {}): Promise<AudioSummary> {
    const player = audioPlayerNode("Music", { soundId: "tone", autoplay: false, loop: options.loop ?? false, volume: options.playerVolume ?? 1 });
    const project = scriptedProject([{ name: "Script", source, attachTo: [options.onPlayer ? "Music" : "Cube"] }], [player]);
    project.sounds = [toneSound("tone", { sampleRate: 16000, seconds: options.seconds ?? 2 })];
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    const summary = summarizeAudio(measureRomAudio(rom, options.listen ?? 7));
    console.info(`[script-audio] ${name}: onset ${summary.onsetMs ?? "none"} ms, ${summary.soundSeconds.toFixed(2)} s of sound, level ${summary.level.toFixed(4)}, max ${summary.maxPeak.toFixed(4)}`);
    return summary;
  }

  it("play() from _ready starts a sound whose player has Autoplay off, at the tone's level", async () => {
    const heard = await run("play-ready", "func _ready():\n    $Music.play()\n");
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.level).toBeGreaterThan(FULL * 0.8);
    expect(heard.soundSeconds).toBeGreaterThan(1.75);
    expect(heard.soundSeconds).toBeLessThan(2.3);
  }, 120_000);

  it("a script on the player itself plays its own sound, with play() alone", async () => {
    const heard = await run("play-self", "func _ready():\n    play()\n", { onPlayer: true });
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.level).toBeGreaterThan(FULL * 0.8);
  }, 120_000);

  it("nothing plays without a call to play()", async () => {
    const heard = await run("silent", "func _ready():\n    $Music.volume = 0.5\n", { loop: true });
    expect(heard.onsetMs).toBeNull();
    expect(heard.maxPeak).toBeLessThan(0.005);
  }, 120_000);

  it("volume set from the script: 50% reads half the level", async () => {
    const full = await run("volume-full", "func _ready():\n    $Music.play()\n", { loop: true });
    const half = await run("volume-half", "func _ready():\n    $Music.volume = 0.5\n    $Music.play()\n", { loop: true });
    expect(half.level / full.level).toBeGreaterThan(0.42);
    expect(half.level / full.level).toBeLessThan(0.58);
  }, 240_000);

  it("volume changed while the sound is playing takes effect at once", async () => {
    const source = "var frames = 0\nfunc _ready():\n    $Music.play()\nfunc _process(delta):\n    frames += 1\n    if frames == 150:\n        $Music.volume = 0.25\n";
    const trace = measureRomAudio(await buildOnly("volume-live", source, { loop: true }), 8);
    // Before frame 150 (2.5 s after start-up) it is at full level; afterwards at a quarter.
    const loud = trace.samples.filter(([t, p]) => t > 1800 && t < 3000 && p > 0.01).map(([, p]) => p);
    const quiet = trace.samples.filter(([t, p]) => t > 4500 && p > 0.001).map(([, p]) => p);
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.info(`[script-audio] volume-live: before ${median(loud).toFixed(4)}, after ${median(quiet).toFixed(4)}`);
    expect(median(loud)).toBeGreaterThan(FULL * 0.8);
    expect(median(quiet) / median(loud)).toBeGreaterThan(0.2);
    expect(median(quiet) / median(loud)).toBeLessThan(0.3);
  }, 240_000);

  it("pitch set from the script: 2x pitch makes a sound that isn't looping last half as long", async () => {
    const normal = await run("pitch-1", "func _ready():\n    $Music.play()\n");
    const doubled = await run("pitch-2", "func _ready():\n    $Music.pitch = 2.0\n    $Music.play()\n");
    expect(normal.soundSeconds).toBeGreaterThan(1.75);
    expect(doubled.soundSeconds).toBeGreaterThan(0.8);
    expect(doubled.soundSeconds).toBeLessThan(1.25);
  }, 240_000);

  it("stop() silences a looping sound a script started", async () => {
    // Starts at once; 90 frames (1.5 s) later a script stops it. A loop would otherwise go on for the whole recording.
    const heard = await run("stop", "var frames = 0\nfunc _ready():\n    $Music.play()\nfunc _process(delta):\n    frames += 1\n    if frames == 90:\n        $Music.stop()\n", { loop: true });
    expect(heard.onsetMs).not.toBeNull();
    expect(heard.soundSeconds).toBeGreaterThan(1.2);
    expect(heard.soundSeconds).toBeLessThan(2.1);
  }, 120_000);

  it("play() again restarts the sound from the beginning", async () => {
    // A 2 s sound, restarted after 90 frames (1.5 s): it sounds for about 1.5 + 2 = 3.5 s instead of 2.
    const heard = await run("restart", "var frames = 0\nfunc _ready():\n    $Music.play()\nfunc _process(delta):\n    frames += 1\n    if frames == 90:\n        $Music.play()\n", { listen: 9 });
    expect(heard.soundSeconds).toBeGreaterThan(3.1);
    expect(heard.soundSeconds).toBeLessThan(3.9);
  }, 120_000);

  /** Builds the same scene as `run` but hands back the ROM, for tests that read the whole trace. */
  async function buildOnly(name: string, source: string, options: { loop?: boolean } = {}): Promise<string> {
    const player = audioPlayerNode("Music", { soundId: "tone", autoplay: false, loop: options.loop ?? false });
    const project = scriptedProject([{ name: "Script", source }], [player]);
    project.sounds = [toneSound("tone", { sampleRate: 16000, seconds: 2 })];
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return rom;
  }
});
