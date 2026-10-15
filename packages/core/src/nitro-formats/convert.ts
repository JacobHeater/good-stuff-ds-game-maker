import type { Animation, AnimationTrack } from "../animation";
import { flattenSceneTreeInOrder, type SceneNode, type Vector3 } from "../scene-node";
import type { ImportedMesh } from "../imported-mesh";
import type { ImportedSound } from "../imported-sound";
import { getSoundSampleCount, rawSoundBytes } from "../imported-sound";
import { encodeNsbca, type NsbcaTrack } from "./nsbca";
import { encodeNsbmd, type NsbmdBone, type NsbmdMaterial, type NsbmdMesh } from "./nsbmd";
import { encodeStrm } from "./strm";

/**
 * Adapters from this project's own data (an imported .obj mesh, a rigged glTF model, an imported sound) to the
 * `nitro-formats/` encoders' own input shapes. See requirements/compiler/STORY.nitro-native-format-converter.md.
 */

/** A plain, un-rigged mesh (a .obj's own shape) as a single-bone NSBMD -- the whole model is one root bone at the origin. */
export function meshToNsbmd(mesh: Pick<ImportedMesh, "positions" | "indices">): { bytes: Uint8Array; warnings: string[] } {
  const bones: NsbmdBone[] = [{ name: "Root", parentIndex: -1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }];
  const materials: NsbmdMaterial[] = [{ name: "Material" }];
  const meshes: NsbmdMesh[] = [{ boneIndex: 0, materialIndex: 0, positions: mesh.positions, indices: mesh.indices }];
  return encodeNsbmd({ bones, materials, meshes });
}

/**
 * A rigged model's bone tree (`RiggedModel.root`, from `gltf-import.ts`) as a multi-bone NSBMD: every `Node3D` in
 * the tree is a bone (its `transform3D` is its bind-pose TRS), and every `MeshInstance3D` child is rigidly
 * attached to its parent bone, matching exactly how the DS draws it already (`gltf-import.ts`'s own "every
 * triangle goes to the one bone that pulls it hardest" design) -- no new skinning or remapping is needed.
 */
export function riggedModelToNsbmd(root: SceneNode, meshesById: ReadonlyMap<string, ImportedMesh>): { bytes: Uint8Array; warnings: string[] } {
  const bones: NsbmdBone[] = [];
  const boneIndexOf = new Map<string, number>();
  const meshes: NsbmdMesh[] = [];
  const materials: NsbmdMaterial[] = [{ name: "Material" }];

  const visit = (node: SceneNode, parentIndex: number): void => {
    if (node.kind === "MeshInstance3D") {
      const importedMeshId = node.mesh?.importedMeshId;
      const mesh = importedMeshId ? meshesById.get(importedMeshId) : undefined;
      if (mesh && parentIndex >= 0) meshes.push({ boneIndex: parentIndex, materialIndex: 0, positions: mesh.positions, indices: mesh.indices });
      return; // a mesh instance has no bones of its own
    }
    const t = node.transform3D;
    const boneIndex = bones.length;
    boneIndexOf.set(node.id, boneIndex);
    bones.push({
      name: node.name,
      parentIndex,
      position: t ? { x: t.position.x, y: t.position.y, z: t.position.z } : { x: 0, y: 0, z: 0 },
      rotation: t ? { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z } : { x: 0, y: 0, z: 0 },
      scale: t ? { x: t.scale.x, y: t.scale.y, z: t.scale.z } : { x: 1, y: 1, z: 1 }
    });
    for (const child of node.children) visit(child, boneIndex);
  };
  visit(root, -1);

  return encodeNsbmd({ bones, materials, meshes });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A track's value at `time` seconds, linearly interpolated between the two keys around it (clamped at the ends); `fallback` when the track has no keys at all. */
function sampleVectorTrack(track: AnimationTrack | undefined, time: number, fallback: Vector3): Vector3 {
  if (!track || track.keys.length === 0) return fallback;
  const keys = track.keys;
  if (time <= keys[0].time) return keys[0].value as Vector3;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value as Vector3;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].time < time) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = (time - a.time) / (b.time - a.time || 1);
  const av = a.value as Vector3;
  const bv = b.value as Vector3;
  return { x: lerp(av.x, bv.x, t), y: lerp(av.y, bv.y, t), z: lerp(av.z, bv.z, t) };
}

/**
 * One of a rigged model's `Animation`s (its sparse, keyframe-at-a-time `AnimationTrack`s, the shape every
 * `AnimationPlayer` already uses) resampled at `fps` frames a second into an NSBCA. Bones with no track at all for
 * a property keep that property at its Model bind pose (no channel is written for it, rather than a channel that
 * just repeats the bind pose every frame).
 */
export function animationToNsbca(root: SceneNode, animation: Animation, fps: number): { bytes: Uint8Array; warnings: string[] } {
  const numFrames = Math.max(1, Math.round(animation.length * fps));
  const bones = flattenSceneTreeInOrder(root).filter((n) => n.kind !== "MeshInstance3D");
  const boneIndexOf = new Map(bones.map((n, i) => [n.id, i]));

  const tracksByNode = new Map<string, { position?: AnimationTrack; rotation?: AnimationTrack; scale?: AnimationTrack }>();
  for (const track of animation.tracks) {
    if (track.property !== "position" && track.property !== "rotation" && track.property !== "scale") continue;
    const entry = tracksByNode.get(track.nodeId) ?? {};
    entry[track.property] = track;
    tracksByNode.set(track.nodeId, entry);
  }

  const tracks: NsbcaTrack[] = [];
  for (const bone of bones) {
    const boneIndex = boneIndexOf.get(bone.id);
    if (boneIndex === undefined) continue;
    const nodeTracks = tracksByNode.get(bone.id);
    if (!nodeTracks) continue; // this bone is never animated: leave it at its Model bind pose entirely
    const t = bone.transform3D;
    const bind = { position: t?.position ?? { x: 0, y: 0, z: 0 }, rotation: t?.rotation ?? { x: 0, y: 0, z: 0 }, scale: t?.scale ?? { x: 1, y: 1, z: 1 } };
    const samples = Array.from({ length: numFrames }, (_, frame) => frame / fps);
    tracks.push({
      boneIndex,
      translation: nodeTracks.position ? samples.map((time) => sampleVectorTrack(nodeTracks.position, time, bind.position)) : undefined,
      rotation: nodeTracks.rotation ? samples.map((time) => sampleVectorTrack(nodeTracks.rotation, time, bind.rotation)) : undefined,
      scale: nodeTracks.scale ? samples.map((time) => sampleVectorTrack(nodeTracks.scale, time, bind.scale)) : undefined
    });
  }

  return encodeNsbca({ numFrames, tracks });
}

/** An imported sound's own stored bytes (PCM16 or this project's DS-native IMA-ADPCM, see `ima-adpcm.ts`) as an STRM. Always mono: this project's own sound pipeline never imports stereo (every DS sound channel is itself mono). */
export function soundToStrm(sound: ImportedSound): Uint8Array {
  const format = sound.format === "ima-adpcm" ? "ima-adpcm" : "pcm16";
  const bytes = rawSoundBytes(sound);
  const sampleCount = getSoundSampleCount(sound);
  return encodeStrm({ sampleRate: sound.sampleRate, channels: [bytes], format, sampleCount });
}
