import { createProjectSnapshot, createSceneNode, encodeSamples, withUpdatedScene, type ImportedSound, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

const sound: ImportedSound = { id: "snd-1", name: "beep", sampleRate: 22050, samples: encodeSamples(new Int16Array([0, 1000, -1000, 32767])) };

function projectWithSound(audio: Record<string, unknown> = {}): ProjectSnapshot {
  const player = createSceneNode({ name: "Music", kind: "AudioStreamPlayer" });
  player.audio = { soundId: sound.id, autoplay: false, volume: 0.4, pitch: 1.5, loop: true, ...audio };
  const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [player] });
  return { ...createProjectSnapshot({ name: "P", mode: "3D", scene }), sounds: [sound] };
}
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

describe("imported sounds and audio players in the project file", () => {
  it("leaves a project with no sounds unchanged: no sounds key, no audio on any node, still valid", () => {
    const plain = createProjectSnapshot({
      name: "P",
      mode: "3D",
      scene: createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "Music", kind: "AudioStreamPlayer" })] })
    });
    const text = serializer.serialize(withUpdatedScene(plain, plain.scene));
    expect(text).not.toContain('"sounds"');
    expect(text).not.toContain('"audio"');
    expect(validator.validate(roundTrip(plain)).valid).toBe(true);
  });

  it("saves and reopens a sound and the player that uses it, identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(projectWithSound())));
    expect(reopened.sounds).toEqual([sound]);
    expect(reopened.scene.children[0].audio).toEqual({ soundId: "snd-1", autoplay: false, volume: 0.4, pitch: 1.5, loop: true });
  });

  it("accepts a player with only some settings, or none, or no sound", () => {
    const project = projectWithSound();
    project.scene.children[0].audio = { autoplay: false } as never;
    expect(validator.validate(roundTrip(project)).valid).toBe(true);
    delete project.scene.children[0].audio;
    expect(validator.validate(roundTrip(project)).valid).toBe(true);
  });

  it("rejects a volume outside 0..1 and a pitch outside 0.25..4, naming the field", () => {
    for (const bad of [{ volume: 1.01 }, { volume: -0.1 }, { pitch: 0.24 }, { pitch: 4.1 }]) {
      const issues = issuesOf(roundTrip(projectWithSound(bad)));
      expect(issues.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(issues.join(" ")).toMatch(/\/audio\/(volume|pitch)/);
    }
    expect(validator.validate(roundTrip(projectWithSound({ volume: 0, pitch: 0.25 }))).valid).toBe(true);
    expect(validator.validate(roundTrip(projectWithSound({ volume: 1, pitch: 4 }))).valid).toBe(true);
  });

  it("rejects fields of the wrong type or that don't exist", () => {
    expect(validator.validate(roundTrip(projectWithSound({ loop: "yes" }))).valid).toBe(false);
    expect(validator.validate(roundTrip(projectWithSound({ autoplay: 1 }))).valid).toBe(false);
    expect(validator.validate(roundTrip(projectWithSound({ echo: true }))).valid).toBe(false);
  });

  it("rejects a player that names a sound the file doesn't contain, naming the player", () => {
    const project = projectWithSound();
    delete project.sounds;
    const issues = issuesOf(roundTrip(project));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Audio player "Music".*snd-1.*isn't in the project file/);
  });

  it("rejects damaged sound data, naming the sound", () => {
    const project = projectWithSound();
    const check = (broken: Partial<ImportedSound>, pattern: RegExp): void => {
      project.sounds = [{ ...sound, ...broken }];
      expect(issuesOf(roundTrip(project)).join(" ")).toMatch(pattern);
    };
    check({ samples: "not base64!!" }, /\/sounds\/0\/samples isn't valid base64/);
    check({ samples: "AAA" }, /isn't valid base64/);
    check({ samples: "" }, /holds 0 bytes/);
    check({ samples: "AAAA" }, /holds 3 bytes.*whole 16-bit sample/); // odd byte count
    check({ sampleRate: 2999 }, /sampleRate is 2999.*3000 to 32000/);
    check({ sampleRate: 32001 }, /sampleRate is 32001/);
    expect(validator.validate({ ...(roundTrip(projectWithSound()) as object), sounds: [{ ...sound, sampleRate: 22050.5 }] }).valid).toBe(false);
  });

  it("rejects duplicate sound ids", () => {
    const project = projectWithSound();
    project.sounds = [sound, { ...sound }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/another sound already uses/);
  });

  it("writes a sound used by two players once, and drops one nothing uses", () => {
    const project = projectWithSound();
    const second = createSceneNode({ name: "Second", kind: "AudioStreamPlayer" });
    second.audio = { soundId: sound.id, autoplay: true, volume: 1, pitch: 1, loop: false };
    const scene = { ...project.scene, children: [...project.scene.children, second] };
    const saved = withUpdatedScene({ ...project, sounds: [sound, { ...sound, id: "unused" }] }, scene);
    const file = JSON.parse(serializer.serialize(saved)) as { sounds: Array<{ id: string }> };
    expect(file.sounds.map((s) => s.id)).toEqual(["snd-1"]);
    expect(validator.validate(file).valid).toBe(true);
  });
});
