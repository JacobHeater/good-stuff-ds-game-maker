import {
  animatableProperties,
  flattenSceneTree,
  isValueForProperty,
  allSceneTrees,
  getSpriteByteSize,
  listScenes,
  getSpriteFrames,
  getSpritePixels,
  getTextureByteSize,
  imaAdpcmByteSize,
  isSoundSampleRate,
  isSpriteSize,
  isTextureSize,
  MAX_SOUND_SAMPLE_RATE,
  MIN_SOUND_SAMPLE_RATE,
  SPRITE_PALETTE_ENTRIES,
  SPRITE_SIZE_LIST,
  type ImportedMesh,
  type ImportedSound,
  type ImportedSprite,
  type ImportedTexture,
  type ProjectScript,
  type ProjectSnapshot,
  type SceneNode,
  TEXTURE_SIZES
} from "@goodstuff/core";
import Ajv, { type ValidateFunction } from "ajv";

import { ProjectValidationError } from "../errors";
import type { ProjectSnapshotValidationResult, ProjectSnapshotValidator } from "../ports/project-snapshot-validator";
import { PROJECT_SNAPSHOT_JSON_SCHEMA } from "./project-snapshot.schema";

/**
 * The default `ProjectSnapshotValidator`, backed by ajv and
 * `PROJECT_SNAPSHOT_JSON_SCHEMA`. Any other implementation of
 * `ProjectSnapshotValidator` (e.g. one backed by a generated-rather-than-
 * hand-authored schema) must honor the same contract — `validate` never
 * throws, `assertValid` throws `ProjectValidationError` — to be a valid
 * substitute wherever this one is used.
 */
export class JsonSchemaProjectSnapshotValidator implements ProjectSnapshotValidator {
  private readonly validateFn: ValidateFunction;

  constructor(ajv: Ajv = new Ajv({ allErrors: true })) {
    this.validateFn = ajv.compile(PROJECT_SNAPSHOT_JSON_SCHEMA);
  }

  validate(candidate: unknown): ProjectSnapshotValidationResult {
    const valid = this.validateFn(candidate);
    if (!valid) {
      const issues = (this.validateFn.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`
      );
      return { valid: false, issues };
    }
    // The schema says the shape is right; what it can't say is whether the parts agree with each other.
    const crossIssues = checkImportedAssets(candidate as ProjectSnapshot);
    return crossIssues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues: crossIssues };
  }

  assertValid(candidate: unknown): ProjectSnapshot {
    const result = this.validate(candidate);
    if (!result.valid) {
      throw new ProjectValidationError("Project file failed schema validation.", result.issues);
    }
    return candidate as ProjectSnapshot;
  }
}

/**
 * Checks what JSON Schema can't. For models: each one's arrays agree (one normal per position, whole
 * triangles, indices that point at real vertices), ids are unique, and every mesh that names a model
 * names one the file contains. Assumes the schema already passed, so the shapes are right.
 */
function checkImportedAssets(project: ProjectSnapshot): string[] {
  const issues: string[] = [];
  const models: ImportedMesh[] = project.meshes ?? [];
  const ids = new Set<string>();
  models.forEach((model, i) => {
    const where = `/meshes/${i}`;
    if (ids.has(model.id)) issues.push(`${where} has the id "${model.id}", which another model already uses`);
    ids.add(model.id);
    if (model.positions.length % 3 !== 0) issues.push(`${where}/positions must hold three numbers per vertex`);
    if (model.normals.length !== model.positions.length) issues.push(`${where}/normals must have one normal for every position`);
    if (model.indices.length % 3 !== 0) issues.push(`${where}/indices must hold three vertex numbers per triangle`);
    const vertexCount = Math.floor(model.positions.length / 3);
    if (model.uvs && model.uvs.length !== vertexCount * 2) issues.push(`${where}/uvs must have two numbers for every vertex`);
    if (model.indices.some((index) => index >= vertexCount)) issues.push(`${where}/indices refers to a vertex the model doesn't have`);
    (model.frames ?? []).forEach((frame, f) => {
      if (frame.positions.length !== model.positions.length || frame.normals.length !== model.positions.length) issues.push(`${where}/frames/${f} must have as many vertices and normals as the model`);
    });
  });
  // Textures: a size the DS supports, texel data of exactly the right length, unique ids.
  const textures: ImportedTexture[] = project.textures ?? [];
  const textureIds = new Set<string>();
  textures.forEach((texture, i) => {
    const where = `/textures/${i}`;
    if (textureIds.has(texture.id)) issues.push(`${where} has the id "${texture.id}", which another texture already uses`);
    textureIds.add(texture.id);
    if (!isTextureSize(texture.width) || !isTextureSize(texture.height)) {
      issues.push(`${where} is ${texture.width} x ${texture.height}, but each side must be one of ${TEXTURE_SIZES.join(", ")}`);
      return;
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(texture.texels) || texture.texels.length % 4 !== 0) {
      issues.push(`${where}/texels isn't valid base64`);
      return;
    }
    const padding = texture.texels.endsWith("==") ? 2 : texture.texels.endsWith("=") ? 1 : 0;
    const decodedBytes = (texture.texels.length / 4) * 3 - padding;
    if (decodedBytes !== getTextureByteSize(texture)) {
      issues.push(`${where}/texels holds ${decodedBytes} bytes, but a ${texture.width} x ${texture.height} texture needs ${getTextureByteSize(texture)}`);
    }
  });

  // Sounds: a sample rate the DS can play, data that is valid base64 holding whole 16-bit samples (at least one), unique ids.
  const sounds: ImportedSound[] = project.sounds ?? [];
  const soundIds = new Set<string>();
  sounds.forEach((sound, i) => {
    const where = `/sounds/${i}`;
    if (soundIds.has(sound.id)) issues.push(`${where} has the id "${sound.id}", which another sound already uses`);
    soundIds.add(sound.id);
    if (!isSoundSampleRate(sound.sampleRate)) {
      issues.push(`${where}/sampleRate is ${sound.sampleRate}, but it must be a whole number from ${MIN_SOUND_SAMPLE_RATE} to ${MAX_SOUND_SAMPLE_RATE}`);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sound.samples) || sound.samples.length % 4 !== 0) {
      issues.push(`${where}/samples isn't valid base64`);
      return;
    }
    const padding = sound.samples.endsWith("==") ? 2 : sound.samples.endsWith("=") ? 1 : 0;
    const decodedBytes = (sound.samples.length / 4) * 3 - padding;
    if (sound.format === "ima-adpcm") {
      if (!Number.isInteger(sound.sampleCount) || sound.sampleCount! < 1) {
        issues.push(`${where}/sampleCount must be a whole number of at least 1 for an ima-adpcm sound`);
      } else if (decodedBytes !== imaAdpcmByteSize(sound.sampleCount!)) {
        issues.push(`${where}/samples holds ${decodedBytes} bytes, but ${sound.sampleCount} ima-adpcm samples need ${imaAdpcmByteSize(sound.sampleCount!)}`);
      }
    } else if (decodedBytes === 0 || decodedBytes % 2 !== 0) {
      issues.push(`${where}/samples holds ${decodedBytes} bytes, but it must hold at least one whole 16-bit sample (two bytes each)`);
    }
  });

  // Sprite images: an exact DS sprite size, valid base64, one byte a pixel, a palette of 1..256 colors that every pixel's index fits in, unique ids.
  const sprites: ImportedSprite[] = project.sprites ?? [];
  const spriteIds = new Set<string>();
  sprites.forEach((sprite, i) => {
    const where = `/sprites/${i}`;
    if (spriteIds.has(sprite.id)) issues.push(`${where} has the id "${sprite.id}", which another sprite image already uses`);
    spriteIds.add(sprite.id);
    if ((sprite.frameWidth === undefined) !== (sprite.frameHeight === undefined)) {
      issues.push(`${where} has only one of frameWidth and frameHeight; a sprite sheet has both`);
      return;
    }
    if (sprite.frameWidth !== undefined && sprite.frameHeight !== undefined) {
      if (!isSpriteSize(sprite.frameWidth, sprite.frameHeight)) {
        issues.push(`${where} has frames of ${sprite.frameWidth} x ${sprite.frameHeight}, but a frame must be one of ${SPRITE_SIZE_LIST}`);
        return;
      }
      if (sprite.width % sprite.frameWidth !== 0 || sprite.height % sprite.frameHeight !== 0) {
        issues.push(`${where} is ${sprite.width} x ${sprite.height}, which isn't a whole number of ${sprite.frameWidth} x ${sprite.frameHeight} frames`);
        return;
      }
    } else if (!isSpriteSize(sprite.width, sprite.height)) {
      issues.push(`${where} is ${sprite.width} x ${sprite.height}, but a sprite must be one of ${SPRITE_SIZE_LIST}`);
      return;
    }
    const base64Bytes = (text: string): number | undefined => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return undefined;
      const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
      return (text.length / 4) * 3 - padding;
    };
    const pixelBytes = base64Bytes(sprite.pixels);
    const paletteBytes = base64Bytes(sprite.palette);
    if (pixelBytes === undefined) issues.push(`${where}/pixels isn't valid base64`);
    if (paletteBytes === undefined) issues.push(`${where}/palette isn't valid base64`);
    if (pixelBytes === undefined || paletteBytes === undefined) return;
    if (pixelBytes !== getSpriteByteSize(sprite)) {
      issues.push(`${where}/pixels holds ${pixelBytes} bytes, but a ${sprite.width} x ${sprite.height} sprite needs ${getSpriteByteSize(sprite)}`);
      return;
    }
    if (paletteBytes === 0 || paletteBytes % 2 !== 0 || paletteBytes / 2 > SPRITE_PALETTE_ENTRIES) {
      issues.push(`${where}/palette holds ${paletteBytes} bytes, but it must hold 1 to ${SPRITE_PALETTE_ENTRIES} colors of two bytes each`);
      return;
    }
    const entries = paletteBytes / 2;
    if (getSpritePixels(sprite).some((index) => index >= entries)) {
      issues.push(`${where}/pixels uses a palette index past the palette's ${entries} colors`);
    }
  });

  // Scripts: unique ids and non-empty names; every attachment names a script in the file.
  const scripts: ProjectScript[] = project.scripts ?? [];
  const scriptIds = new Set<string>();
  scripts.forEach((script, i) => {
    const where = `/scripts/${i}`;
    if (scriptIds.has(script.id)) issues.push(`${where} has the id "${script.id}", which another script already uses`);
    scriptIds.add(script.id);
    if (script.name.trim() === "") issues.push(`${where}/name is empty; a script needs a name`);
  });

  const visit = (node: SceneNode): void => {
    if (node.scriptId !== undefined && !scriptIds.has(node.scriptId)) {
      issues.push(`Node "${node.name}" uses the script "${node.scriptId}", which isn't in the project file`);
    }
    const soundId = node.audio?.soundId;
    if (soundId !== undefined && !soundIds.has(soundId)) {
      issues.push(`Audio player "${node.name}" uses the sound "${soundId}", which isn't in the project file`);
    }
    if (node.spriteId !== undefined && !spriteIds.has(node.spriteId)) {
      issues.push(`Sprite "${node.name}" uses the image "${node.spriteId}", which isn't in the project file`);
    }
    if (node.spriteAnimations) {
      const sheet = node.spriteId === undefined ? undefined : sprites.find((sprite) => sprite.id === node.spriteId);
      const frameCount = sheet ? getSpriteFrames(sheet).count : undefined;
      const names = new Set<string>();
      for (const animation of node.spriteAnimations.animations ?? []) {
        if (names.has(animation.name)) issues.push(`Animated sprite "${node.name}" has two animations called "${animation.name}"`);
        names.add(animation.name);
        const bad = frameCount === undefined ? undefined : animation.frames.find((frame) => frame >= frameCount);
        if (bad !== undefined) issues.push(`Animation "${animation.name}" of "${node.name}" shows frame ${bad}, but the sheet has ${frameCount} frames`);
      }
      const start = node.spriteAnimations.start;
      if (start !== undefined && !names.has(start)) issues.push(`Animated sprite "${node.name}" starts with the animation "${start}", which it doesn't have`);
    }
    const id = node.mesh?.importedMeshId;
    if (id !== undefined && !ids.has(id)) issues.push(`Mesh "${node.name}" uses the imported model "${id}", which isn't in the project file`);
    const textureId = node.mesh?.textureId;
    if (textureId !== undefined && !textureIds.has(textureId)) {
      issues.push(`Mesh "${node.name}" uses the texture "${textureId}", which isn't in the project file`);
    }
  };
  for (const tree of allSceneTrees(project)) {
    flattenSceneTree(tree).forEach(visit);
    // A track animates a node of its own scene, so each scene is checked on its own.
    issues.push(...checkAnimations({ ...project, scene: tree }));
  }
  issues.push(...checkScenes(project));
  return issues;
}

/** Scenes (requirements/scene-designer/STORY.multiple-scenes.md): every scene has a name a script can call it by, and names and ids are unique. */
function checkScenes(project: ProjectSnapshot): string[] {
  const issues: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const entry of listScenes(project)) {
    if (entry.name.trim() === "") issues.push("A scene has no name");
    else if (names.has(entry.name)) issues.push(`Two scenes are called "${entry.name}"`);
    names.add(entry.name);
    if (ids.has(entry.id)) issues.push(`Two scenes have the id "${entry.id}"`);
    ids.add(entry.id);
  }
  return issues;
}

/**
 * Animations (requirements/animation/TASK.animation-model-and-persistence.md): unique ids and names, keys in order and inside the length, values that suit their
 * property, tracks whose node is in the file and has that property, and an autoplay that names an animation of the player.
 */
function checkAnimations(project: ProjectSnapshot): string[] {
  const issues: string[] = [];
  const nodes = flattenSceneTree(project.scene);
  const kindById = new Map(nodes.map((node) => [node.id, node.kind]));
  for (const player of nodes) {
    const animations = player.animation?.animations ?? [];
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const animation of animations) {
      const where = `Animation "${animation.name}" of "${player.name}"`;
      if (ids.has(animation.id)) issues.push(`${where} has the id "${animation.id}", which another animation of the player already uses`);
      ids.add(animation.id);
      if (animation.name.trim() === "") issues.push(`An animation of "${player.name}" has no name`);
      else if (names.has(animation.name)) issues.push(`${where}: the player has another animation with this name`);
      names.add(animation.name);
      const trackIds = new Set<string>();
      for (const track of animation.tracks) {
        if (trackIds.has(track.id)) issues.push(`${where} has two tracks with the id "${track.id}"`);
        trackIds.add(track.id);
        const targetKind = kindById.get(track.nodeId);
        if (targetKind === undefined) {
          issues.push(`${where}: a ${track.property} track animates the node "${track.nodeId}", which isn't in the project file`);
        } else if (!animatableProperties(targetKind).includes(track.property)) {
          issues.push(`${where}: a ${track.property} track can't animate a ${targetKind}`);
        }
        let previous = -Infinity;
        for (const key of track.keys) {
          if (key.time > animation.length) issues.push(`${where}: a ${track.property} key at ${key.time} s is past the animation's length of ${animation.length} s`);
          if (key.time <= previous) issues.push(`${where}: the ${track.property} keys are not in time order (or two share a time) at ${key.time} s`);
          previous = key.time;
          if (!isValueForProperty(track.property, key.value)) issues.push(`${where}: a ${track.property} key at ${key.time} s has a value of the wrong kind`);
        }
      }
    }
    const autoplay = player.animation?.autoplay;
    if (autoplay !== undefined && !ids.has(autoplay)) issues.push(`Animation player "${player.name}" autoplays "${autoplay}", which isn't one of its animations`);
  }
  return issues;
}
