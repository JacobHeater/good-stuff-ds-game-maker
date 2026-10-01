import type { AudioClip } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { hasErrors } from "./diagnostics";
import { audioPlayerNode, scriptedProject, soundProbeProject, toneSound } from "./fixtures";
import { writeSceneDataC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/audio/STORY.named-audio-clips.md: an AudioStreamPlayer's own named sounds, playable with play("name"). */

const sceneOf = (project: ReturnType<typeof soundProbeProject>) => {
  const result = translateScene3D(project);
  if (!result.scene) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
  return result;
};

function makeClip(name: string, soundId: string, extra: Partial<AudioClip> = {}): AudioClip {
  return { id: `id-${name}`, name, soundId, volume: 1, pitch: 1, loop: false, ...extra };
}

describe("compiling named audio clips", () => {
  it("a player with its own sound and named clips gets a clipStart/clipCount range into a shared audioClips table", () => {
    const morning = toneSound("morning", { seconds: 0.01 });
    const day = toneSound("day", { seconds: 0.01, hz: 300 });
    const main = toneSound("main", { seconds: 0.01, hz: 100 });
    const player = audioPlayerNode("Music", { soundId: "main", clips: [makeClip("Morning", "morning"), makeClip("Day", "day", { volume: 0.5, loop: true })] });
    const { scene } = sceneOf(soundProbeProject([player], [main, morning, day]));
    expect(scene!.audioPlayers).toHaveLength(1);
    expect(scene!.audioPlayers[0]).toMatchObject({ clipStart: 0, clipCount: 2 });
    expect(scene!.audioClips).toHaveLength(2);
    expect(scene!.audioClips[1]).toMatchObject({ volume: 64, loop: true });
    expect(scene!.sounds.map((s) => s.label)).toEqual(["main", "morning", "day"]);
  });

  it("a player with no sound of its own, only named clips, still compiles (sound: -1)", () => {
    const morning = toneSound("morning", { seconds: 0.01 });
    const player = audioPlayerNode("Music", { clips: [makeClip("Morning", "morning")] });
    const project = { ...scriptedProject([{ source: 'func _ready():\n    $Music.play("Morning")\n', attachTo: ["Cube"] }], [player]), sounds: [morning] };
    const { scene, diagnostics } = translateScene3D(project);
    expect(hasErrors(diagnostics)).toBe(false);
    const music = scene!.audioPlayers.find((p) => p.clipCount > 0)!;
    expect(music.sound).toBe(-1);
    expect(music.autoplay).toBe(false);
  });

  it("a sound shared between the player's own sound, a clip, and another player is written once", () => {
    const tone = toneSound("tone", { seconds: 0.01 });
    const a = audioPlayerNode("A", { soundId: "tone", clips: [makeClip("Again", "tone")] });
    const b = audioPlayerNode("B", { soundId: "tone" });
    const { scene } = sceneOf(soundProbeProject([a, b], [tone]));
    expect(scene!.sounds).toHaveLength(1);
    expect(scene!.audioPlayers[0].sound).toBe(0);
    expect(scene!.audioClips[0].sound).toBe(0);
    expect(scene!.audioPlayers[1].sound).toBe(0);
  });

  it("a clip's sound counts toward the sound-memory budget, same as the player's own", () => {
    const tone = toneSound("tone", { seconds: 0.01 });
    const other = toneSound("other", { seconds: 0.01, hz: 400 });
    const player = audioPlayerNode("Music", { clips: [makeClip("A", "tone"), makeClip("B", "other")] });
    const { scene } = sceneOf(soundProbeProject([player], [tone, other]));
    expect(scene!.sounds.map((s) => s.label).sort()).toEqual(["other", "tone"]);
  });

  it("refuses a clip whose sound isn't in the project, naming the clip", () => {
    const player = audioPlayerNode("Music", { clips: [makeClip("Morning", "gone")] });
    const result = translateScene3D(soundProbeProject([player], []));
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "missing-sound", nodeName: "Music", message: expect.stringContaining('"Morning"') }));
  });

  it("refuses a clip with no sound chosen yet, naming the clip", () => {
    const player = audioPlayerNode("Music", { clips: [{ id: "id-morning", name: "Morning", volume: 1, pitch: 1, loop: false }] });
    const result = translateScene3D(soundProbeProject([player], []));
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "missing-sound", nodeName: "Music", message: expect.stringContaining('"Morning" sound hasn\'t been chosen') }));
  });

  it("compiles play(\"name\") to gs_audio_play_clip with the clip's resolved index", () => {
    const morning = toneSound("morning", { seconds: 0.01 });
    const day = toneSound("day", { seconds: 0.01, hz: 300 });
    const player = audioPlayerNode("Music", { clips: [makeClip("Morning", "morning"), makeClip("Day", "day")] });
    const base = { ...scriptedProject([{ source: 'func _ready():\n    $Music.play("Day")\n', attachTo: ["Cube"] }], [player]), sounds: [morning, day] };
    const { scene, diagnostics } = translateScene3D(base);
    expect(hasErrors(diagnostics)).toBe(false);
    expect(scene!.scriptCode).toContain("gs_audio_play_clip(gs_node_audio_player(");
    expect(scene!.scriptCode).toMatch(/gs_audio_play_clip\(gs_node_audio_player\(\d+\), 1\)/);
  });
});

describe("the generated C for named audio clips", () => {
  it("emits GsAudioClip entries and the player's clipStart/clipCount", () => {
    const morning = toneSound("morning", { sampleRate: 8000, seconds: 0.001 });
    const day = toneSound("day", { sampleRate: 8000, seconds: 0.001, hz: 300 });
    const player = audioPlayerNode("Music", { soundId: "morning", clips: [makeClip("Morning", "morning"), makeClip("Day", "day", { volume: 0.5, loop: true })] });
    const text = writeSceneDataC(sceneOf(soundProbeProject([player], [morning, day])).scene!);
    expect(text).toMatch(/static const GsAudioClip audioClips\[\] = \{\n {2}\{ 0, \d+, 127, 0 \},\n {2}\{ 1, \d+, 64, 1 \}\n\};/);
    expect(text).toMatch(/static const GsAudioPlayer audioPlayers\[\] = \{\n {2}\{ 0, \d+, 127, 0, \d, 0, 2 \}\n\};/);
  });
});
