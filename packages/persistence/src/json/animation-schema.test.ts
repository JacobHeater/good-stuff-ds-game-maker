import { createProjectSnapshot, createSceneNode, type Animation, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

/** requirements/animation/TASK.animation-model-and-persistence.md */

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

interface Made {
  project: ProjectSnapshot;
  player: SceneNode;
  cube: SceneNode;
  sound: SceneNode;
}
function make(mutate?: (made: Made, animation: Animation) => void): Made {
  const cube = createSceneNode({ name: "Cube", kind: "MeshInstance3D" });
  const sound = createSceneNode({ name: "Music", kind: "AudioStreamPlayer" });
  const player = createSceneNode({ name: "Anim", kind: "AnimationPlayer" });
  const animation: Animation = {
    id: "a1",
    name: "slide",
    length: 2,
    loop: true,
    tracks: [
      { id: "t1", nodeId: cube.id, property: "position", keys: [{ time: 0, value: { x: -2, y: 0, z: 0 } }, { time: 2, value: { x: 2, y: 0, z: 0 } }] },
      { id: "t2", nodeId: cube.id, property: "visible", keys: [{ time: 0, value: true }, { time: 1, value: false }] },
      { id: "t3", nodeId: sound.id, property: "volume", keys: [{ time: 0, value: 1 }, { time: 2, value: 0.25 }] }
    ]
  };
  player.animation = { autoplay: "a1", speed: 1.5, animations: [animation, { id: "a2", name: "spin", length: 1, loop: false, tracks: [] }] };
  const project = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [cube, sound, player] }) });
  const made = { project, player, cube, sound };
  mutate?.(made, animation);
  return made;
}
const issuesOf = (made: Made): string[] => [...validator.validate(JSON.parse(JSON.stringify(made.project))).issues];
const roundTrip = (project: ProjectSnapshot): ProjectSnapshot => validator.assertValid(serializer.deserialize(serializer.serialize(project)));

describe("animations in the project file", () => {
  it("leaves a project without animations unchanged: no animation key", () => {
    const plain = createProjectSnapshot({ name: "P", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D" }) });
    expect(serializer.serialize(plain)).not.toContain('"animation"');
  });

  it("round-trips animations, tracks, keys, autoplay and speed exactly", () => {
    const made = make();
    expect(issuesOf(made)).toEqual([]);
    const reopened = roundTrip(made.project);
    const player = reopened.scene.children.find((c) => c.kind === "AnimationPlayer")!;
    expect(player.animation).toEqual(made.player.animation);
  });

  it("is offered in a 2D project too (it has no transform), and the file accepts the kind", () => {
    const player = createSceneNode({ name: "Anim", kind: "AnimationPlayer" });
    const project = createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children: [player] }) });
    expect(validator.validate(JSON.parse(JSON.stringify(project))).valid).toBe(true);
    expect(player.transform3D).toBeUndefined();
  });

  it("rejects keys out of order, two keys at one time, and a key past the length", () => {
    expect(issuesOf(make((_, a) => a.tracks[0].keys.reverse())).join("|")).toMatch(/keys are not in time order/);
    expect(issuesOf(make((_, a) => (a.tracks[0].keys[1].time = 0))).join("|")).toMatch(/keys are not in time order/);
    expect(issuesOf(make((_, a) => (a.tracks[0].keys[1].time = 5))).join("|")).toMatch(/key at 5 s is past the animation's length of 2 s/);
  });

  it("rejects a value of the wrong kind for its property", () => {
    expect(issuesOf(make((_, a) => (a.tracks[0].keys[0].value = 3))).join("|")).toMatch(/position key at 0 s has a value of the wrong kind/);
    expect(issuesOf(make((_, a) => (a.tracks[1].keys[0].value = 1))).join("|")).toMatch(/visible key at 0 s has a value of the wrong kind/);
    expect(issuesOf(make((_, a) => (a.tracks[2].keys[0].value = true))).join("|")).toMatch(/volume key at 0 s has a value of the wrong kind/);
  });

  it("rejects a track for a node that isn't in the file, or one that can't have that property", () => {
    expect(issuesOf(make((_, a) => (a.tracks[0].nodeId = "ghost"))).join("|")).toMatch(/animates the node "ghost", which isn't in the project file/);
    expect(issuesOf(make((made, a) => (a.tracks[2].nodeId = made.cube.id))).join("|")).toMatch(/a volume track can't animate a MeshInstance3D/);
    expect(issuesOf(make((made, a) => (a.tracks[0].nodeId = made.sound.id))).join("|")).toMatch(/a position track can't animate a AudioStreamPlayer/);
  });

  it("rejects duplicate animation names and ids, duplicate track ids, an empty name, and an autoplay that names nothing", () => {
    expect(issuesOf(make((made) => (made.player.animation!.animations![1].name = "slide"))).join("|")).toMatch(/the player has another animation with this name/);
    expect(issuesOf(make((made) => (made.player.animation!.animations![1].id = "a1"))).join("|")).toMatch(/which another animation of the player already uses/);
    expect(issuesOf(make((_, a) => (a.tracks[1].id = "t1"))).join("|")).toMatch(/two tracks with the id "t1"/);
    expect(issuesOf(make((made) => (made.player.animation!.animations![1].name = "  "))).join("|")).toMatch(/has no name/);
    expect(issuesOf(make((made) => (made.player.animation!.autoplay = "nope"))).join("|")).toMatch(/autoplays "nope", which isn't one of its animations/);
  });

  it("rejects a length or speed out of range, an unknown property and an unknown key", () => {
    expect(issuesOf(make((_, a) => (a.length = 0.01))).length).toBeGreaterThan(0);
    expect(issuesOf(make((_, a) => (a.length = 1000))).length).toBeGreaterThan(0);
    expect(issuesOf(make((made) => (made.player.animation!.speed = 0))).length).toBeGreaterThan(0);
    expect(issuesOf(make((made) => (made.player.animation!.speed = 11))).length).toBeGreaterThan(0);
    expect(issuesOf(make((_, a) => ((a.tracks[0] as { property: string }).property = "color"))).length).toBeGreaterThan(0);
    expect(issuesOf(make((_, a) => ((a as unknown as { extra: number }).extra = 1))).length).toBeGreaterThan(0);
    expect(issuesOf(make((_, a) => (a.tracks[0].keys[0].time = -1))).length).toBeGreaterThan(0);
  });
});
