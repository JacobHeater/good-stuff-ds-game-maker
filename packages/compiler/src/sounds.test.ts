import { DS_HARDWARE_PROFILE, encodeSamples, getSoundSamples, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { hasErrors } from "./diagnostics";
import { audioPlayerNode, soundProbeProject, toneSound } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

const codes = (project: ProjectSnapshot): string[] => translateScene3D(project).diagnostics.map((d) => d.code);
const sceneOf = (project: ProjectSnapshot) => {
  const result = translateScene3D(project);
  if (!result.scene) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
  return result;
};

describe("compiling audio players", () => {
  it("turns a player into a sound and a player entry with the DS's volume, playback rate and loop", () => {
    const tone = toneSound("tone", { sampleRate: 22050, seconds: 0.2 }); // 4410 samples: even, so nothing is padded
    const { scene } = sceneOf(soundProbeProject([audioPlayerNode("Music", { soundId: "tone", volume: 0.5, pitch: 2, loop: true })], [tone]));
    expect(scene!.sounds).toHaveLength(1);
    expect(scene!.sounds[0]).toMatchObject({ key: "sound:tone", label: "tone", sampleRate: 22050 });
    expect(scene!.sounds[0].samples).toEqual(Array.from(getSoundSamples(tone)));
    expect(scene!.audioPlayers).toEqual([{ sound: 0, volume: 64, frequency: 44100, loop: true, autoplay: true }]);
  });

  it("writes a sound used by several players once", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    const other = toneSound("other", { seconds: 0.05, hz: 220 });
    const players = [
      audioPlayerNode("A", { soundId: "tone" }),
      audioPlayerNode("B", { soundId: "other", volume: 0 }),
      audioPlayerNode("C", { soundId: "tone", pitch: 0.5 })
    ];
    const { scene } = sceneOf(soundProbeProject(players, [tone, other]));
    expect(scene!.sounds.map((s) => s.label)).toEqual(["tone", "other"]);
    expect(scene!.audioPlayers.map((p) => [p.sound, p.volume, p.frequency])).toEqual([[0, 127, 16000], [1, 0, 16000], [0, 127, 8000]]);
  });

  it("pads an odd number of samples to a whole 4-byte word with silence", () => {
    const five = { id: "five", name: "five", sampleRate: 8000, samples: encodeSamples(new Int16Array([1, 2, 3, 4, 5])) };
    const { scene } = sceneOf(soundProbeProject([audioPlayerNode("A", { soundId: "five" })], [five]));
    expect(scene!.sounds[0].samples).toEqual([1, 2, 3, 4, 5, 0]);
    const even = { ...five, id: "even", samples: encodeSamples(new Int16Array([1, 2, 3, 4])) };
    expect(sceneOf(soundProbeProject([audioPlayerNode("A", { soundId: "even" })], [even])).scene!.sounds[0].samples).toHaveLength(4);
  });

  it("leaves out a hidden player and a player under a hidden node", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    const hidden = audioPlayerNode("Hidden", { soundId: "tone" });
    hidden.visible = false;
    const inside = audioPlayerNode("Inside", { soundId: "tone" });
    const group = { ...audioPlayerNode("Group"), kind: "Node3D" as const, visible: false, children: [inside] };
    const { scene } = sceneOf(soundProbeProject([hidden, group, audioPlayerNode("Shown", { soundId: "tone" })], [tone]));
    expect(scene!.audioPlayers).toHaveLength(1);
  });

  it("compiles with no players at all, to empty tables", () => {
    const { scene } = sceneOf(soundProbeProject([], []));
    expect(scene!.sounds).toEqual([]);
    expect(scene!.audioPlayers).toEqual([]);
  });

  it("refuses a player whose sound isn't in the project, naming the player", () => {
    const result = translateScene3D(soundProbeProject([audioPlayerNode("Music", { soundId: "gone" })], []));
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "missing-sound", nodeName: "Music" }));
  });

  it("warns about a player with no sound, and leaves it out", () => {
    const result = translateScene3D(soundProbeProject([audioPlayerNode("Empty")], []));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "player-without-sound", nodeName: "Empty" }));
    expect(result.scene!.audioPlayers).toEqual([]);
  });

  it("keeps a player with Autoplay off in the ROM but warns that nothing starts it", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    const result = translateScene3D(soundProbeProject([audioPlayerNode("Quiet", { soundId: "tone", autoplay: false })], [tone]));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "sound-not-started", nodeName: "Quiet" }));
    expect(result.scene!.audioPlayers[0].autoplay).toBe(false);
  });

  it("limits the playback rate to what the hardware takes, with a warning", () => {
    const high = toneSound("high", { sampleRate: 32000, seconds: 0.05 });
    const result = translateScene3D(soundProbeProject([audioPlayerNode("Fast", { soundId: "high", pitch: 4 })], [high]));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "sound-pitch-clamped", nodeName: "Fast" }));
    expect(result.scene!.audioPlayers[0].frequency).toBe(65535);
    expect(codes(soundProbeProject([audioPlayerNode("Ok", { soundId: "high", pitch: 2 })], [high]))).not.toContain("sound-pitch-clamped");
  });

  it("allows sixteen simultaneous sounds and refuses a seventeenth", () => {
    const tone = toneSound("tone", { seconds: 0.01 });
    const players = (autoplaying: number, total: number) =>
      Array.from({ length: total }, (_, i) => audioPlayerNode(`P${i}`, { soundId: "tone", autoplay: i < autoplaying }));
    expect(codes(soundProbeProject(players(16, 16), [tone]))).not.toContain("too-many-sounds");
    expect(codes(soundProbeProject(players(16, 20), [tone]))).not.toContain("too-many-sounds"); // the other four don't start
    const result = translateScene3D(soundProbeProject(players(17, 17), [tone]));
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "too-many-sounds", message: expect.stringContaining("17") }));
  });

  it("checks the distinct sounds against the sound budget, counting each once", () => {
    const limit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
    const rate = 16000;
    const almostHalf = toneSound("a", { sampleRate: rate, seconds: (limit / 2 / 2 - 100) / rate });
    const players = [audioPlayerNode("P1", { soundId: "a" }), audioPlayerNode("P2", { soundId: "a" }), audioPlayerNode("P3", { soundId: "a" })];
    // Three players on one sound cost one sound's memory.
    expect(codes(soundProbeProject(players, [almostHalf]))).not.toContain("sound-memory");
    // Three different sounds of that size don't fit.
    const three = ["a", "b", "c"].map((id) => ({ ...almostHalf, id }));
    const result = translateScene3D(soundProbeProject(["a", "b", "c"].map((id) => audioPlayerNode(id, { soundId: id })), three));
    expect(result.scene).toBeNull();
    expect(result.diagnostics.find((d) => d.code === "sound-memory")?.message).toMatch(/need \d+ bytes.*2097152/);
    // A sound nothing uses costs nothing.
    expect(codes(soundProbeProject([audioPlayerNode("P", { soundId: "a" })], three))).not.toContain("sound-memory");
  });

  it("doesn't let an audio player's screen make the scene look like it draws on two screens", () => {
    const tone = toneSound("tone", { seconds: 0.01 });
    const player = audioPlayerNode("Bottom", { soundId: "tone" });
    player.screen = "bottom";
    expect(codes(soundProbeProject([player], [tone]))).not.toContain("mixed-screens");
  });
});

describe("the generated C for sounds", () => {
  const tone = toneSound("tone", { sampleRate: 8000, seconds: 0.001 }); // 8 samples
  const text = writeSceneDataC(sceneOf(soundProbeProject([audioPlayerNode("A", { soundId: "tone", volume: 0.5, pitch: 2, loop: true }), audioPlayerNode("B", { soundId: "tone", autoplay: false })], [tone])).scene!);

  it("emits each sound as an aligned constant array and fills GsSound and GsAudioPlayer in order", () => {
    expect(text).toContain("/* sound tone: 8 samples at 8000 Hz, 16 bytes */");
    expect(text).toMatch(/static const int16_t sound_0_samples\[\] __attribute__\(\(aligned\(4\)\)\) = \{\n  [-\d, ]+\n\};/);
    expect(text).toContain("static const GsSound sounds[] = {\n  { 8, 8000, sound_0_samples }\n};");
    expect(text).toContain("static const GsAudioPlayer audioPlayers[] = {\n  { 0, 16000, 64, 1, 1 },\n  { 0, 8000, 127, 0, 0 }\n};");
    expect(text).toContain("  1, 2, 0, /* sound, audio player, collider counts */\n  0, 0, 0, 0, /* animation player, animation, track, key counts */\n  nodes, primitives, meshes, lights, textures, sounds, audioPlayers, colliders, animationPlayers, animations, animTracks, animKeys\n};");
  });

  it("is data only, and the same scene gives the same text", () => {
    expect(text).not.toMatch(/\b(if|for|while|return)\b\s*\(/);
    expect(writeSceneDataC(sceneOf(soundProbeProject([audioPlayerNode("A", { soundId: "tone", volume: 0.5, pitch: 2, loop: true }), audioPlayerNode("B", { soundId: "tone", autoplay: false })], [tone])).scene!)).toBe(text);
  });

  it("gives empty tables a placeholder entry, since C doesn't allow an empty array", () => {
    const empty = writeSceneDataC(sceneOf(soundProbeProject([], [])).scene!);
    expect(empty).toContain("static const GsSound sounds[] = {\n  { 0, 0, 0 }\n};");
    expect(empty).toContain("static const GsAudioPlayer audioPlayers[] = {\n  { 0, 0, 0, 0, 0 }\n};");
    expect(empty).toContain("  0, 0, 0, /* sound, audio player, collider counts */");
  });
});
