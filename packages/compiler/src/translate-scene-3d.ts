import {
  checkScriptOnNodes,
  DS_HARDWARE_PROFILE,
  triangleBudgetFor,
  DS_MAX_LIGHTS,
  describeMeshSource,
  flattenSceneTree,
  dsVolume,
  getAnimationPlayer,
  getAudioPlayer,
  getCollisionShape,
  getLightIntensity,
  getSoundByteSize,
  getSpriteTransform,
  getThreeDScreen,
  isUpright,
  otherScreen,
  textureMemoryLimit,
  getTouchArea2DRect,
  getTouchArea3D,
  isTwoDVisualKind,
  rawSoundBytes,
  getTextureByteSize,
  getTextureTexels,
  lightLevelFromIntensity,
  meshSourceKey,
  playbackFrequency,
  resolveMeshGeometry,
  resolveMeshFrameGeometry,
  approximateConvexHull,
  getMeshFrameCount,
  alphaLevelFromOpacity,
  getMeshDiffuseLevels,
  getSpriteAnimations,
  resolveMeshTexture,
  textureSizeClass,
  type AudioClip,
  DS_MIN_PLAYBACK_HZ,
  type FpsTarget,
  type ImportedSound,
  type ProjectScript,
  type ProjectSnapshot,
  type SceneNode,
  type ScriptCheckResult,
  type Vector3,
  sceneNamesOf,
  collectProjectGlobals,
  type ProjectGlobal
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import { collectSprites } from "./translate-scene-2d";
import type { DsAnimation, DsAnimationKey, DsAnimationPlayer, DsAnimationTrack, DsAudioClip, DsAudioPlayer, DsCamera, DsCollider, DsLight, DsMesh, DsNode, DsPrimitive, DsScene3D, DsSound, DsSpriteAnimation, DsTexture, DsTouchArea } from "./ds-scene";
import { FixedPointRangeError, packNormal, rgb15, toF32, toT16, toV10, toV16 } from "./fixed-point";
import { fontSafeText } from "./label-text";
import { axisDirection, composeTransform, IDENTITY, invertAffine, multiply, splitScale, transformPoint, withoutScale, type Mat4 } from "./matrix";
import { generateScriptCode, type CompiledScript } from "./script-codegen";

/** The DS's geometry engine has four hardware lights (defined once in core, with the rest of the DS lighting model). */
export const MAX_DS_LIGHTS = DS_MAX_LIGHTS;

/**
 * Values used where the scene model doesn't say. Until cameras, lights and meshes have properties
 * (requirements/scene-designer/STORY.camera-light-and-material-properties.md) every scene gets these.
 * The field of view matches the editor viewport's orbit camera.
 */
export const DEFAULTS = {
  fovDegrees: 50,
  nearPlane: 0.1,
  farPlane: 100,
  meshDiffuse: rgb15(24, 24, 24),
  /** A textured mesh is drawn white: the DS multiplies the texture by the lit color, and grey would darken the picture. */
  texturedMeshDiffuse: rgb15(31, 31, 31),
} as const;

export interface TranslateOptions {
  /**
   * The presentation rate. Not part of a saved project today (the FPS target is editor state), so the
   * caller supplies it; defaults to the DS profile's default.
   */
  fpsTarget?: FpsTarget;
  /** This scene's place in the project's list of scenes (the starting scene is 0). It names the scene's generated script code, so scenes can share one file. */
  sceneIndex?: number;
  /** The names of all the project's scenes, for `change_scene("name")`. Defaults to the project's own. */
  sceneNames?: readonly string[];
}

export interface TranslateResult {
  /** Null exactly when `diagnostics` contains an error. */
  scene: DsScene3D | null;
  diagnostics: Diagnostic[];
}

/**
 * Globals in the order the runtime's `gs_global[]` actually holds them: every non-string global first, in their
 * original (alphabetical) order, then every string one last, in theirs. A string global's value is a pointer to a
 * ROM constant, not a number the save file can meaningfully round-trip between builds (the same *name and type* of
 * globals can still get a different signature-matching save file across two builds that differ only in some other,
 * unrelated string literal, which shifts where that string constant actually lives in ROM) -- so `gs_global_count`
 * (`scene-data-writer.ts`) only spans this numeric prefix, and every string global sits safely past it, reset to
 * its compile-time value every time the game starts rather than loaded from a save file at all.
 */
export function orderGlobalsForRuntime(globals: readonly ProjectGlobal[]): ProjectGlobal[] {
  return [...globals].sort((a, b) => Number(a.type === "string") - Number(b.type === "string"));
}

interface Collected {
  node: SceneNode;
  world: Mat4;
  /** Index in the scene's node table. */
  index: number;
}

/** A node kept in the scene, with what the node table needs to know about it. */
interface KeptNode extends Collected {
  parent: number;
  /** The node and all its ancestors are visible, as the scene stands before any script runs. */
  effectivelyVisible: boolean;
  dynamic: boolean;
}

/**
 * Translates a saved 3D project into the description the DS runtime draws. Pure: no files, no
 * toolchain. Walks the tree as a hierarchy (a node's transform is relative to its parent's, and a
 * hidden node hides its whole subtree), bakes each drawn node's world transform, and reports
 * anything that can't be represented instead of dropping it silently.
 */
export function translateScene3D(project: ProjectSnapshot, options: TranslateOptions = {}): TranslateResult {
  const diagnostics: Diagnostic[] = [];

  if (project.mode !== "3D") {
    diagnostics.push({
      severity: "error",
      code: "not-a-3d-project",
      message: "This is a 2D project, which the 3D translator can't compile."
    });
    return { scene: null, diagnostics };
  }

  // ---- Scripts first: they decide which nodes must be kept and which can move.
  const scripts = checkProjectScripts(project, diagnostics, options.sceneNames ?? sceneNamesOf(project));
  const globals = orderGlobalsForRuntime(scripts.globals);

  const meshes: Collected[] = [];
  const cameras: Collected[] = [];
  const directionalLights: Collected[] = [];
  const audioNodes: Collected[] = [];
  const shapeNodes: Collected[] = [];
  const animationNodes: Collected[] = [];
  const touchNodes: Collected[] = [];
  const kept: KeptNode[] = [];

  /** Whether `node` or anything under it is attached to a script or named by one. */
  const touchedMemo = new Map<string, boolean>();
  const containsTouched = (node: SceneNode): boolean => {
    let answer = touchedMemo.get(node.id);
    if (answer === undefined) {
      answer = scripts.touchedIds.has(node.id) || node.children.some(containsTouched);
      touchedMemo.set(node.id, answer);
    }
    return answer;
  };

  // Animations: every node an animation animates is kept in the game (even hidden), and a node whose position, rotation or scale is animated is moved by the
  // runtime. (Only the animations of a player that is in the game count.)
  const markAnimated = (node: SceneNode, chainVisible: boolean): void => {
    const visible = chainVisible && node.visible;
    if (node.kind === "AnimationPlayer" && (visible || scripts.touchedIds.has(node.id))) {
      for (const animation of getAnimationPlayer(node).animations) {
        for (const track of animation.tracks) {
          scripts.touchedIds.add(track.nodeId);
          if (track.property === "position" || track.property === "rotation" || track.property === "scale") scripts.dynamicRootIds.add(track.nodeId);
        }
      }
    }
    for (const child of node.children) markAnimated(child, visible);
  };
  markAnimated(project.scene, true);

  const visit = (node: SceneNode, parentWorld: Mat4, parent: number, parentVisible: boolean, parentDynamic: boolean): void => {
    // A hidden node (and what is under it) is left out, unless a script can reach something in it: then it is kept, hidden.
    if (!node.visible && !containsTouched(node)) return;
    const local = node.transform3D
      ? composeTransform(node.transform3D.position, node.transform3D.rotation, node.transform3D.scale)
      : IDENTITY;
    const world = multiply(parentWorld, local);
    const index = kept.length;
    const dynamic = parentDynamic || scripts.dynamicRootIds.has(node.id);
    const effectivelyVisible = parentVisible && node.visible;
    kept.push({ node, world, index, parent, effectivelyVisible, dynamic });

    switch (node.kind) {
      case "MeshInstance3D":
        meshes.push({ node, world, index });
        break;
      case "Camera3D":
        cameras.push({ node, world, index });
        break;
      case "DirectionalLight3D":
        directionalLights.push({ node, world, index });
        break;
      case "OmniLight3D":
        diagnostics.push({
          severity: "warning",
          code: "omni-light-skipped",
          nodeName: node.name,
          message: "The DS has no positional lights, so this light was left out."
        });
        break;
      case "AudioStreamPlayer":
        audioNodes.push({ node, world, index });
        break;
      case "CollisionShape3D":
        shapeNodes.push({ node, world, index });
        break;
      case "AnimationPlayer":
        animationNodes.push({ node, world, index });
        break;
      case "TouchArea2D":
      case "TouchArea3D":
        touchNodes.push({ node, world, index });
        break;
      default:
        // Node3D groups draw nothing and are ignored by design. A Sprite2D is drawn on the 2D screen (see `collectSprites` below); every other node for the 2D
        // screen is a different matter: the ROM doesn't draw those yet.
        if (isTwoDVisualKind(node.kind) && node.kind !== "Node2D" && node.kind !== "Sprite2D" && node.kind !== "AnimatedSprite2D" && node.kind !== "Label") {
          diagnostics.push({
            severity: "warning",
            code: "two-d-node-not-built",
            nodeName: node.name,
            message: `This ${node.kind} is on the ${node.screen} (2D) screen, and the ROM only draws Sprite2D, AnimatedSprite2D and Label there so far, so it isn't drawn. It is saved with the project.`
          });
        }
        break;
    }
    for (const child of node.children) visit(child, world, index, effectivelyVisible, dynamic);
  };
  visit(project.scene, IDENTITY, -1, true, false);

  // Meshes that can't be drawn.
  const drawableMeshes = meshes.filter(({ node }) => {
    if (!node.mesh) {
      diagnostics.push({
        severity: "warning",
        code: "mesh-without-geometry",
        nodeName: node.name,
        message: "This mesh has no geometry, so it was left out."
      });
      return false;
    }
    const geometry = resolveMeshGeometry(node.mesh, project.meshes);
    if (geometry && node.mesh.textureId !== undefined) {
      if (!resolveMeshTexture(node.mesh, project.textures)) {
        diagnostics.push({
          severity: "error",
          code: "missing-texture",
          nodeName: node.name,
          message: "This mesh uses a texture that isn't in the project, so there is nothing to draw it with. Import the texture again or clear it."
        });
        return false;
      }
      if (!geometry.uvs) {
        diagnostics.push({
          severity: "error",
          code: "texture-needs-uvs",
          nodeName: node.name,
          message: "This mesh has a texture, but its model has no texture coordinates (UVs) to place it with. Clear the texture, or import a model that has UVs."
        });
        return false;
      }
    }
    if (!geometry) {
      // A model the project doesn't contain is a broken project, not something to leave out quietly.
      diagnostics.push({
        severity: "error",
        code: "missing-model",
        nodeName: node.name,
        message: "This mesh uses an imported model that isn't in the project, so there is nothing to draw. Import the model again or pick another mesh."
      });
      return false;
    }
    return true;
  });

  // Camera. A Camera3D explicitly marked current (core's `isCurrentCamera`) wins outright; otherwise the first
  // effectively-visible one, else the first in the tree, exactly as before `current` existed.
  const markedCurrent = cameras.find((c) => c.node.camera?.current === true);
  if (cameras.length === 0) {
    diagnostics.push({ severity: "error", code: "no-camera", message: "The scene needs a Camera3D." });
  } else if (cameras.length > 1 && !markedCurrent) {
    diagnostics.push({
      severity: "warning",
      code: "multiple-cameras",
      nodeName: cameras[0].node.name,
      message: `The scene has ${cameras.length} cameras and none is marked current; the first one in the tree is used.`
    });
  }

  // Lights.
  if (directionalLights.length > MAX_DS_LIGHTS) {
    diagnostics.push({
      severity: "error",
      code: "too-many-lights",
      message: `The DS supports ${MAX_DS_LIGHTS} lights and the scene has ${directionalLights.length}.`
    });
  }

  // Triangle budget, from the same geometry that is emitted. Targeting 30fps gives the GPU twice as long per frame, so
  // it doubles how many triangles fit (triangleBudgetFor).
  const triangles = drawableMeshes.reduce((sum, { node }) => sum + resolveMeshGeometry(node.mesh!, project.meshes)!.triangleCount, 0);
  const limit = triangleBudgetFor(options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget);
  if (triangles > limit) {
    diagnostics.push({
      severity: "error",
      code: "over-triangle-budget",
      message: `The scene has ${triangles} triangles and the DS can draw about ${limit} per frame.`
    });
  }

  // Texture memory: each distinct texture the drawn meshes use is uploaded once.
  const usedTextures = new Map<string, number>();
  for (const { node } of drawableMeshes) {
    const texture = resolveMeshTexture(node.mesh!, project.textures);
    if (texture) usedTextures.set(texture.id, getTextureByteSize(texture));
  }
  const textureBytes = [...usedTextures.values()].reduce((sum, bytes) => sum + bytes, 0);
  // The sprites on the 2D screen (the sub engine). One VRAM bank holds their tiles, so with sprites the textures get 384 KB instead of 512 KB.
  const twoDScreen = otherScreen(getThreeDScreen(project) ?? "top");
  const keptIndexOf = new Map(kept.map((entry) => [entry.node.id, entry.index]));
  const twoDSprites = collectSprites(project, () => twoDScreen, [twoDScreen], diagnostics, options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget, {
    nodeIndexOf: (node) => keptIndexOf.get(node.id),
    reachedByScript: (node) => scripts.touchedIds.has(node.id),
    // Rotation and scale need a rotation matrix: a sprite that starts turned or scaled, or one whose transform a script writes.
    rotatable: (node) => !isUpright(getSpriteTransform(node)) || scripts.dynamicRootIds.has(node.id)
  })[twoDScreen];
  const textureLimit = textureMemoryLimit(twoDSprites.images.length > 0);
  if (textureBytes > textureLimit) {
    diagnostics.push({
      severity: "error",
      code: "texture-memory",
      message:
        `The scene's textures need ${textureBytes} bytes and the DS has ${textureLimit} bytes of texture memory` +
        (twoDSprites.images.length > 0 ? ` (one 128 KB bank of the 512 KB holds the sprites on the 2D screen).` : ".")
    });
  }

  // Audio players. A player with neither its own sound nor any named clips is left out; naming a sound the project
  // lacks (the player's own, or a clip's) is a broken project. Only players that will start at once use a hardware
  // channel (all sixteen of them play PCM); a clip, started only by play("name"), never does by itself.
  const playablePlayers: Array<{
    node: SceneNode;
    sound: ImportedSound | null;
    clips: Array<{ clip: AudioClip; sound: ImportedSound }>;
    settings: ReturnType<typeof getAudioPlayer>;
    startsAtOnce: boolean;
  }> = [];
  const audioByNode = new Map<string, Collected & { effectivelyVisible: boolean }>();
  for (const entry of audioNodes) audioByNode.set(entry.node.id, { ...entry, effectivelyVisible: kept[entry.index].effectivelyVisible });
  for (const { node } of audioNodes) {
    const settings = getAudioPlayer(node);
    const hasOwnSound = settings.soundId !== undefined;
    if (!hasOwnSound && (settings.clips?.length ?? 0) === 0) {
      diagnostics.push({
        severity: "warning",
        code: "player-without-sound",
        nodeName: node.name,
        message: "This audio player has no sound assigned, so it was left out."
      });
      continue;
    }
    let sound: ImportedSound | null = null;
    if (hasOwnSound) {
      sound = project.sounds?.find((candidate) => candidate.id === settings.soundId) ?? null;
      if (!sound) {
        diagnostics.push({
          severity: "error",
          code: "missing-sound",
          nodeName: node.name,
          message: "This audio player uses a sound that isn't in the project, so there is nothing to play. Import the sound again or clear it."
        });
        continue;
      }
      if (playbackFrequency(sound.sampleRate, settings.pitch).clamped) {
        diagnostics.push({
          severity: "warning",
          code: "sound-pitch-clamped",
          nodeName: node.name,
          message: `A pitch of ${settings.pitch} on a ${sound.sampleRate} Hz sound is more than the DS's sound hardware can play, so the playback rate was limited.`
        });
      }
    }
    // Every clip must have a real sound: its index among the player's clips is baked into every play("name") that
    // resolved against it at check time, so there is no "skip a bad one and shift the rest" option here.
    let brokenClip = false;
    const clips: Array<{ clip: AudioClip; sound: ImportedSound }> = [];
    for (const clip of settings.clips ?? []) {
      const clipSound = clip.soundId ? (project.sounds?.find((candidate) => candidate.id === clip.soundId) ?? null) : null;
      if (!clipSound) {
        diagnostics.push({
          severity: "error",
          code: "missing-sound",
          nodeName: node.name,
          message: clip.soundId
            ? `This audio player's "${clip.name}" sound isn't in the project, so there is nothing to play. Import it again or clear it.`
            : `This audio player's "${clip.name}" sound hasn't been chosen yet.`
        });
        brokenClip = true;
        continue;
      }
      if (playbackFrequency(clipSound.sampleRate, clip.pitch).clamped) {
        diagnostics.push({
          severity: "warning",
          code: "sound-pitch-clamped",
          nodeName: node.name,
          message: `A pitch of ${clip.pitch} on "${clip.name}" (${clipSound.sampleRate} Hz) is more than the DS's sound hardware can play, so the playback rate was limited.`
        });
      }
      clips.push({ clip, sound: clipSound });
    }
    if (brokenClip) continue;
    if (hasOwnSound && !settings.autoplay && !scripts.playedIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        code: "sound-not-started",
        nodeName: node.name,
        message: "Autoplay is off and no script calls play() on this player, so nothing starts this sound; it stays silent."
      });
    }
    // A player starts by itself only if it has its own sound, Autoplay on, and is visible as the scene stands (a hidden one is not in the game until a script shows it).
    playablePlayers.push({ node, sound, clips, settings, startsAtOnce: hasOwnSound && settings.autoplay && (audioByNode.get(node.id)?.effectivelyVisible ?? true) });
  }
  const autoplaying = playablePlayers.filter(({ startsAtOnce }) => startsAtOnce).length;
  const channels = DS_HARDWARE_PROFILE.audio.channels;
  if (autoplaying > channels) {
    diagnostics.push({
      severity: "error",
      code: "too-many-sounds",
      message: `${autoplaying} audio players start at once, but the DS has ${channels} sound channels.`
    });
  }
  const usedSounds = new Map<string, ImportedSound>();
  for (const { sound, clips } of playablePlayers) {
    if (sound) usedSounds.set(sound.id, sound);
    for (const { sound: clipSound } of clips) usedSounds.set(clipSound.id, clipSound);
  }
  const soundBytes = [...usedSounds.values()].reduce((sum, sound) => sum + getSoundByteSize(sound), 0);
  const soundLimit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
  if (soundBytes > soundLimit) {
    diagnostics.push({
      severity: "error",
      code: "sound-memory",
      message: `The scene's sounds need ${soundBytes} bytes and a game can use ${soundLimit} bytes of the DS's RAM for sound.`
    });
  }

  // Collision shapes do something only when a script uses them: a shape passed to overlaps(), a shape under a body a script moves with
  // move_and_collide(), or a solid shape when some script moves a body (a solid shape is the ground that body is stopped by).
  const underMovedBody = (index: number): boolean => {
    for (let i = index; i >= 0; i = kept[i].parent) if (scripts.moveIds.has(kept[i].node.id)) return true;
    return false;
  };
  for (const { node, index } of shapeNodes) {
    const used = scripts.overlapIds.has(node.id) || underMovedBody(index) || (getCollisionShape(node).solid && scripts.moveIds.size > 0);
    if (!used) {
      diagnostics.push({
        severity: "warning",
        code: "collision-shape-unused",
        nodeName: node.name,
        message: getCollisionShape(node).solid
          ? "This solid shape stops nothing: no script moves a body with move_and_collide(), so it does nothing in the game."
          : "No script passes this collision shape to overlaps() or moves it as a body with move_and_collide(), so it does nothing in the game."
      });
    }
  }

  // Touch areas do something only when a script asks them, and only where the stylus can reach them: the bottom screen is the touch screen, so a
  // TouchArea2D must be on it (the 2D screen must be the bottom one) and a TouchArea3D needs the 3D engine on it.
  const threeDScreen = getThreeDScreen(project) ?? "top";
  for (const { node } of touchNodes) {
    if (!scripts.touchIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        code: "touch-area-unused",
        nodeName: node.name,
        message: "No script asks this touch area whether it is touched (is_touched(), is_touch_pressed() or is_touch_released()), so it does nothing in the game."
      });
    }
    const screen = node.kind === "TouchArea3D" ? threeDScreen : node.screen;
    if (screen !== "bottom") {
      diagnostics.push({
        severity: "warning",
        code: "touch-area-not-touchable",
        nodeName: node.name,
        message:
          node.kind === "TouchArea3D"
            ? "This TouchArea3D can never be touched: the 3D scene is on the top screen, and only the bottom screen senses the stylus. Put the 3D engine on the bottom screen."
            : "This TouchArea2D is on the top screen, which does not sense the stylus, so it can never be touched. Put the 2D screen on the bottom."
      });
    }
  }

  if (hasErrors(diagnostics)) return { scene: null, diagnostics };

  // Build the DS-format description. Any value that doesn't fit becomes a diagnostic naming its node.
  const guard = <T>(node: SceneNode, build: () => T): T | null => {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof FixedPointRangeError)) throw error;
      diagnostics.push({
        severity: "error",
        code: "out-of-range",
        nodeName: node.name,
        message:
          error.format === "t16"
            ? `A texture coordinate (${error.value}) is too far outside the picture for the DS; keep the model's UVs closer to 0..1 (a large texture can repeat only a couple of times).`
            : `A value (${error.value}) doesn't fit the DS's ${error.format} number format; move or scale it closer to the origin.`
      });
      return null;
    }
  };
  const matrixF32 = (m: Mat4): number[] => m.map(toF32);

  const primitives: DsPrimitive[] = [];
  const primitiveIndex = new Map<string, number>();
  const textures: DsTexture[] = [];
  const textureIndex = new Map<string, number>();
  /** 1 + the texture's index in the scene's texture list, adding it the first time it's used. */
  const indexOfTexture = (texture: NonNullable<ReturnType<typeof resolveMeshTexture>>): number => {
    const existing = textureIndex.get(texture.id);
    if (existing !== undefined) return existing + 1;
    textures.push({
      key: `texture:${texture.id}`,
      label: texture.name,
      width: texture.width,
      height: texture.height,
      sizeS: textureSizeClass(texture.width),
      sizeT: textureSizeClass(texture.height),
      texels: Array.from(getTextureTexels(texture))
    });
    textureIndex.set(texture.id, textures.length - 1);
    return textures.length;
  };
  // A vertex table is per geometry AND texture: texture coordinates are in texels, so they depend on the texture's size.
  const indexOfPrimitive = (mesh: NonNullable<SceneNode["mesh"]>, frame = 0): number => {
    const texture = resolveMeshTexture(mesh, project.textures);
    const key = (texture ? `${meshSourceKey(mesh)}|texture:${texture.id}` : meshSourceKey(mesh)) + (frame > 0 ? `#frame${frame}` : "");
    const existing = primitiveIndex.get(key);
    if (existing !== undefined) return existing;
    const geometry = (frame > 0 ? resolveMeshFrameGeometry(mesh, project.meshes, frame) : resolveMeshGeometry(mesh, project.meshes))!;
    const normals: number[] = [];
    for (let i = 0; i < geometry.normals.length; i += 3) {
      normals.push(packNormal(geometry.normals[i], geometry.normals[i + 1], geometry.normals[i + 2]));
    }
    primitives.push({
      key,
      label: describeMeshSource(mesh, project.meshes) + (frame > 0 ? ` pose ${frame}` : "") + (texture ? ` + ${texture.name}` : ""),
      triangleCount: geometry.triangleCount,
      positions: geometry.positions.map(toV16),
      normals,
      ...(texture && geometry.uvs
        ? { texcoords: geometry.uvs.map((value, i) => toT16(value, i % 2 === 0 ? texture.width : texture.height)) }
        : {})
    });
    primitiveIndex.set(key, primitives.length - 1);
    return primitives.length - 1;
  };

  const dsMeshes: DsMesh[] = [];
  const meshFrames: number[] = [];
  const meshAnimations: DsSpriteAnimation[] = [];
  const gameFps = options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget;
  for (const { node, world, index } of drawableMeshes) {
    const built = guard(node, () => {
      const texture = resolveMeshTexture(node.mesh!, project.textures);
      // Rotation and translation go to the DS as one matrix and scale as another thing: see `splitScale`.
      const { rigid, scale } = splitScale(world);
      // Frame animations: a model with several poses, and animations that say which pose to show when.
      const poses = getMeshFrameCount(node.mesh!, project.meshes);
      const authored = getSpriteAnimations(node);
      let frameStart = 0;
      let frameCount = 0;
      let animationFirst = 0;
      let animationStart = -1;
      let animationCount = 0;
      if (authored.animations.length > 0 && poses <= 1) {
        diagnostics.push({
          severity: "warning",
          code: "animated-mesh-without-frames",
          nodeName: node.name,
          message: "This mesh has animations, but its model has only one pose, so it never changes. Import the model from several .obj files (one for each pose) to animate it."
        });
      } else if (authored.animations.length > 0) {
        const bad = authored.animations.find((animation) => animation.frames.some((frame) => frame >= poses));
        if (bad) {
          diagnostics.push({
            severity: "error",
            code: "animation-frame-out-of-range",
            nodeName: node.name,
            message: `The animation "${bad.name}" shows pose ${bad.frames.find((frame) => frame >= poses)}, but the model has ${poses} poses (0 to ${poses - 1}).`
          });
          return null;
        }
        frameStart = meshFrames.length;
        frameCount = poses;
        for (let f = 0; f < poses; f++) meshFrames.push(indexOfPrimitive(node.mesh!, f));
        animationFirst = meshAnimations.length;
        for (const animation of authored.animations) {
          meshAnimations.push({ frames: animation.frames, step: Math.max(1, Math.round((animation.fps * 4096) / gameFps)), loop: animation.loop });
        }
        animationCount = authored.animations.length;
        const start = authored.start === undefined ? -1 : authored.animations.findIndex((animation) => animation.name === authored.start);
        animationStart = start < 0 ? -1 : animationFirst + start;
      }
      return {
        node: index,
        frameStart,
        frameCount,
        animation: animationStart,
        animationFirst,
        animationCount,
        primitive: indexOfPrimitive(node.mesh!),
        texture: texture ? indexOfTexture(texture) : 0,
        diffuse: ((levels) => rgb15(levels[0], levels[1], levels[2]))(getMeshDiffuseLevels(node.mesh!, texture !== undefined)),
        world: matrixF32(rigid),
        scale: scale.map(toF32) as [number, number, number],
        unlit: node.mesh!.unlit === true,
        cull: node.mesh!.cull ?? "none",
        alpha: alphaLevelFromOpacity(node.mesh!.alpha ?? 1)
      };
    });
    if (built) dsMeshes.push(built);
  }

  const dsLights: DsLight[] = [];
  for (const { node, world, index } of directionalLights) {
    // A directional light shines along its local -Z axis, as in Godot. Its intensity is the level of a white light:
    // the DS has light colors, not strengths (see core's ds-lighting.ts).
    const [x, y, z] = axisDirection(world, "z");
    const level = lightLevelFromIntensity(getLightIntensity(node));
    dsLights.push({ node: index, color: rgb15(level, level, level), direction: [toV10(-x), toV10(-y), toV10(-z)] });
  }

  let dsCamera: DsCamera | null = null;
  const cameraEntry = markedCurrent ?? cameras.find((c) => kept[c.index].effectivelyVisible) ?? cameras[0];
  dsCamera = guard(cameraEntry.node, () => ({
    node: cameraEntry.index,
    fovDegrees: DEFAULTS.fovDegrees,
    tanHalfFov: Math.tan((DEFAULTS.fovDegrees * Math.PI) / 360),
    nearPlane: DEFAULTS.nearPlane,
    farPlane: DEFAULTS.farPlane,
    view: matrixF32(invertAffine(withoutScale(cameraEntry.world)))
  }));

  if (hasErrors(diagnostics) || !dsCamera) return { scene: null, diagnostics };

  // Sounds, in the order they are first used; each is written once however many players (or clips) use it.
  const sounds: DsSound[] = [];
  const soundIndex = new Map<string, number>();
  const indexOfSound = (sound: ImportedSound): number => {
    let index = soundIndex.get(sound.id);
    if (index === undefined) {
      const bytes = Array.from(rawSoundBytes(sound));
      while (bytes.length % 4 !== 0) bytes.push(0); // a whole number of 4-byte words
      const format = sound.format === "ima-adpcm" ? "ima-adpcm" : "pcm16";
      sounds.push({ key: `sound:${sound.id}`, label: sound.name, sampleRate: sound.sampleRate, format, bytes });
      index = sounds.length - 1;
      soundIndex.set(sound.id, index);
    }
    return index;
  };
  const audioClips: DsAudioClip[] = [];
  const audioPlayers: DsAudioPlayer[] = playablePlayers.map(({ sound, clips, settings, startsAtOnce }) => {
    // The player's own sound (if it has one) is resolved first, so it's the earlier entry in `sounds` -- a player's
    // own sound reads naturally before its clips', the order they're declared in the Inspector too.
    const soundIndex = sound ? indexOfSound(sound) : -1;
    const clipStart = audioClips.length;
    for (const { clip, sound: clipSound } of clips) {
      audioClips.push({
        sound: indexOfSound(clipSound),
        volume: dsVolume(clip.volume),
        frequency: playbackFrequency(clipSound.sampleRate, clip.pitch).hz,
        loop: clip.loop
      });
    }
    return {
      sound: soundIndex,
      volume: sound ? dsVolume(settings.volume) : 0,
      frequency: sound ? playbackFrequency(sound.sampleRate, settings.pitch).hz : DS_MIN_PLAYBACK_HZ,
      loop: settings.loop,
      autoplay: startsAtOnce,
      clipStart,
      clipCount: clips.length
    };
  });

  // The node table: every kept node, parents first (that is the order `visit` kept them in).
  const audioIndexByNode = new Map(playablePlayers.map(({ node }, i) => [node.id, i]));
  // Collision shapes, in tree order. A shape's size is in the DS's number format: half extents for a box, and for a capsule half the straight part.
  const colliders: DsCollider[] = [];
  const colliderIndexByNode = new Map<string, number>();
  for (const { node, world, index } of shapeNodes) {
    const data = getCollisionShape(node);
    // A hull wraps its parent's mesh (requirements/collision/STORY.collision-polygon-wraps-mesh.md): the mesh's own vertices, moved into the
    // shape's local space (the parent's world transform, then this shape node's own undone), so the hull follows the mesh wherever this node
    // is placed or turned relative to it.
    if (data.shape === "convexHull") {
      const parentIndex = kept[index].parent;
      const parentEntry = parentIndex >= 0 ? kept[parentIndex] : undefined;
      const geometry = parentEntry?.node.kind === "MeshInstance3D" && parentEntry.node.mesh ? resolveMeshGeometry(parentEntry.node.mesh, project.meshes) : undefined;
      if (!parentEntry || parentEntry.node.kind !== "MeshInstance3D" || !geometry) {
        diagnostics.push({
          severity: "error",
          code: "collision-hull-needs-mesh",
          nodeName: node.name,
          message: `This shape is set to wrap a mesh (Convex Hull), which needs a MeshInstance3D with geometry as its parent, and ${
            !parentEntry || parentEntry.node.kind !== "MeshInstance3D" ? "its parent isn't one" : "its parent mesh has no geometry"
          }.`
        });
        continue;
      }
      const toLocal = invertAffine(world);
      const localPoints: Vector3[] = [];
      for (let i = 0; i + 2 < geometry.positions.length; i += 3) {
        const meshLocal: Vector3 = { x: geometry.positions[i], y: geometry.positions[i + 1], z: geometry.positions[i + 2] };
        localPoints.push(transformPoint(toLocal, transformPoint(parentEntry.world, meshLocal)));
      }
      const hullPoints = approximateConvexHull(localPoints);
      const built = guard(node, (): DsCollider => ({
        shape: "convexHull",
        solid: data.solid,
        params: [toF32(Math.max(0, ...hullPoints.map((p) => Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)))), 0, 0],
        hull: hullPoints.map((p): [number, number, number] => [toF32(p.x), toF32(p.y), toF32(p.z)])
      }));
      if (built) {
        colliderIndexByNode.set(node.id, colliders.length);
        colliders.push(built);
      }
      continue;
    }
    const built = guard(node, (): DsCollider => {
      switch (data.shape) {
        case "box":
          return { shape: "box", solid: data.solid, params: [toF32(data.size.x / 2), toF32(data.size.y / 2), toF32(data.size.z / 2)] };
        case "sphere":
          return { shape: "sphere", solid: data.solid, params: [toF32(data.radius), 0, 0] };
        case "capsule":
          return { shape: "capsule", solid: data.solid, params: [toF32(data.radius), toF32(Math.max(0, data.height / 2 - data.radius)), 0] };
        case "cylinder":
          return { shape: "cylinder", solid: data.solid, params: [toF32(data.radius), toF32(data.height / 2), 0] };
        case "convexHull":
          throw new Error("unreachable: convexHull is handled, and continue's, above");
      }
    });
    if (built) {
      colliderIndexByNode.set(node.id, colliders.length);
      colliders.push(built);
    }
  }
  // Touch areas, in tree order. A rectangle is in whole screen pixels; a volume is in the DS's number format (half extents for a box).
  const touchAreas: DsTouchArea[] = [];
  const touchIndexByNode = new Map<string, number>();
  for (const { node, index } of touchNodes) {
    const built = guard(node, (): DsTouchArea => {
      if (node.kind === "TouchArea2D") {
        const rect = getTouchArea2DRect(node);
        return { node: index, shape: "rect", rect: [rect.x, rect.y, rect.width, rect.height], params: [0, 0, 0] };
      }
      const data = getTouchArea3D(node);
      return data.shape === "box"
        ? { node: index, shape: "box", rect: [0, 0, 0, 0], params: [toF32(data.size.x / 2), toF32(data.size.y / 2), toF32(data.size.z / 2)] }
        : { node: index, shape: "sphere", rect: [0, 0, 0, 0], params: [toF32(data.radius), 0, 0] };
    });
    if (built) {
      touchIndexByNode.set(node.id, touchAreas.length);
      touchAreas.push(built);
    }
  }
  const f32x3 = (v: { x: number; y: number; z: number }): [number, number, number] => [toF32(v.x), toF32(v.y), toF32(v.z)];
  // Animations. Each track names the node it animates by its place in the node table.
  const keptIndexById = new Map(kept.map((entry) => [entry.node.id, entry.index]));
  const animationPlayers: DsAnimationPlayer[] = [];
  const animations: DsAnimation[] = [];
  const animationTracks: DsAnimationTrack[] = [];
  const animationKeys: DsAnimationKey[] = [];
  const animPlayerIndexByNode = new Map<string, number>();
  for (const { node } of animationNodes) {
    const data = getAnimationPlayer(node);
    if (data.animations.length === 0) {
      diagnostics.push({ severity: "warning", code: "player-without-animations", nodeName: node.name, message: "This animation player has no animations, so it was left out." });
      continue;
    }
    if (data.autoplay === undefined && !scripts.animPlayedIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        code: "animation-not-started",
        nodeName: node.name,
        message: "None of this player's animations is its Autoplay and no script calls play() on it, so nothing starts an animation; it does nothing in the game."
      });
    }
    const built = guard(node, () => {
      const animationStart = animations.length;
      for (const animation of data.animations) {
        const trackStart = animationTracks.length;
        for (const track of animation.tracks) {
          const target = keptIndexById.get(track.nodeId);
          if (target === undefined) {
            diagnostics.push({
              severity: "error",
              code: "animation-target-missing",
              nodeName: node.name,
              message: `The animation "${animation.name}" has a ${track.property} track for a node that isn't in the game, so it can't be built. Delete that track.`
            });
            continue;
          }
          const keyStart = animationKeys.length;
          for (const key of track.keys) {
            const value = key.value;
            animationKeys.push({
              time: toF32(key.time),
              value:
                typeof value === "object"
                  ? [toF32(value.x), toF32(value.y), toF32(value.z)]
                  : typeof value === "boolean"
                    ? [value ? 1 : 0, 0, 0]
                    : [toF32(value), 0, 0]
            });
          }
          animationTracks.push({ property: track.property, node: target, keyStart, keyCount: track.keys.length });
        }
        animations.push({ name: animation.name, length: toF32(animation.length), loop: animation.loop, trackStart, trackCount: animationTracks.length - trackStart });
      }
      return {
        animationStart,
        animationCount: data.animations.length,
        autoplay: data.autoplay === undefined ? -1 : data.animations.findIndex((animation) => animation.id === data.autoplay),
        speed: toF32(data.speed)
      } satisfies DsAnimationPlayer;
    });
    if (built) {
      animPlayerIndexByNode.set(node.id, animationPlayers.length);
      animationPlayers.push(built);
    }
  }

  const dsNodes: DsNode[] = [];
  for (const entry of kept) {
    const built = guard(entry.node, () => {
      const { rigid, scale } = splitScale(entry.world);
      const local = entry.node.transform3D;
      // A Sprite2D keeps its 2D state in the same slots: position x, y in pixels, its angle (degrees, clockwise) in the third rotation slot, scale x, y.
      const sprite = entry.node.kind === "Sprite2D" || entry.node.kind === "AnimatedSprite2D" ? { position: entry.node.position, ...getSpriteTransform(entry.node) } : null;
      return {
        name: entry.node.name,
        parent: entry.parent,
        position: sprite ? ([toF32(sprite.position.x), toF32(sprite.position.y), 0] as [number, number, number]) : local ? f32x3(local.position) : ([0, 0, 0] as [number, number, number]),
        rotation: sprite ? ([0, 0, toF32(sprite.rotation)] as [number, number, number]) : local ? f32x3(local.rotation) : ([0, 0, 0] as [number, number, number]),
        scale: sprite ? ([toF32(sprite.scale.x), toF32(sprite.scale.y), toF32(1)] as [number, number, number]) : local ? f32x3(local.scale) : ([toF32(1), toF32(1), toF32(1)] as [number, number, number]),
        visible: entry.node.visible,
        dynamic: entry.dynamic,
        world: matrixF32(rigid),
        worldScale: scale.map(toF32) as [number, number, number],
        audio: audioIndexByNode.get(entry.node.id) ?? -1,
        collider: colliderIndexByNode.get(entry.node.id) ?? -1,
        animPlayer: animPlayerIndexByNode.get(entry.node.id) ?? -1,
        touch: touchIndexByNode.get(entry.node.id) ?? -1
      };
    });
    if (built) dsNodes.push(built);
  }
  if (hasErrors(diagnostics)) return { scene: null, diagnostics };

  // Scripts, translated to C now that every node has its place in the table.
  const indexById = new Map(kept.map((entry) => [entry.node.id, entry.index]));
  const compiledScripts: CompiledScript[] = scripts.compiled.map(({ script, result, attached }) => ({
    name: script.name,
    program: result.program,
    instances: attached.map((node) => indexById.get(node.id)!).sort((a, b) => a - b)
  }));
  const scriptCode = generateScriptCode(compiledScripts, indexById, options.sceneIndex ? `sc${options.sceneIndex}_` : "", new Map(globals.map((g, i) => [g.name, i])));

  return {
    scene: {
      screen: getThreeDScreen(project) ?? "top", // the project's choice (its scene root's screen): the DS drives 3D on one screen, and the other is the 2D screen
      fps: options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
      camera: dsCamera,
      lights: dsLights,
      meshes: dsMeshes,
      primitives,
      textures,
      sounds,
      audioPlayers,
      audioClips,
      colliders,
      animationPlayers,
      animations,
      animationTracks,
      animationKeys,
      touchAreas,
      meshFrames,
      meshAnimations,
      sprites2D: twoDSprites,
      globals: globals.map((g) => ({
        name: g.name,
        type: g.type,
        value: g.type === "float" ? toF32(g.initial as number) : g.type === "string" ? fontSafeText(g.initial as string) : g.initial
      })),
      nodes: dsNodes,
      scriptCode
    },
    diagnostics
  };
}

/** What the scripts in a project mean for the scene, worked out before the scene is walked. Shared with the 2D translator (`translate-scene-2d.ts`), since checking scripts and building the global-variable table don't depend on anything 3D-specific. */
export interface ScriptPlan {
  /** Nodes a script is attached to or names with `$Name`: they (and their ancestors) are kept even if hidden. */
  touchedIds: Set<string>;
  /** Nodes whose transform a script writes: these, and everything under them, are moved by the runtime each frame. */
  dynamicRootIds: Set<string>;
  /** Nodes a script calls `play()` on. */
  playedIds: Set<string>;
  /** AnimationPlayers a script calls `play("name")` on. */
  animPlayedIds: Set<string>;
  /** Collision shapes a script passes to `overlaps()`. */
  overlapIds: Set<string>;
  /** Touch areas a script asks about (`is_touched()` and the others). */
  touchIds: Set<string>;
  /** Nodes a script moves with `move_and_collide()` (the bodies): the shapes under them, and every solid shape, are used by that. */
  moveIds: Set<string>;
  /** The project's global variables, sorted by name. */
  globals: ProjectGlobal[];
  /** Each script that is attached to something, checked, with the nodes it is attached to. */
  compiled: Array<{ script: ProjectScript; result: ScriptCheckResult; attached: SceneNode[] }>;
}

/**
 * Checks every attached script against the scene (a script nothing uses isn't compiled, so a half-written one never blocks a build)
 * and reports each problem as a diagnostic naming the script, line and column.
 */
export function checkProjectScripts(project: ProjectSnapshot, diagnostics: Diagnostic[], sceneNames: readonly string[]): ScriptPlan {
  const plan: ScriptPlan = { touchedIds: new Set(), dynamicRootIds: new Set(), playedIds: new Set(), animPlayedIds: new Set(), overlapIds: new Set(), touchIds: new Set(), moveIds: new Set(), globals: [], compiled: [] };
  const scriptsById = new Map((project.scripts ?? []).map((script) => [script.id, script]));
  const attachments = new Map<string, SceneNode[]>();
  for (const node of flattenSceneTree(project.scene)) {
    if (node.scriptId === undefined) continue;
    if (!scriptsById.has(node.scriptId)) {
      diagnostics.push({
        severity: "error",
        code: "missing-script",
        nodeName: node.name,
        message: "This node uses a script that isn't in the project. Attach another script or clear it."
      });
      continue;
    }
    attachments.set(node.scriptId, [...(attachments.get(node.scriptId) ?? []), node]);
  }

  // The project's global variables: the same in every scene, declared by any script and usable by all of them.
  const collected = collectProjectGlobals(project.scripts ?? []);
  plan.globals = collected.globals;
  for (const problem of collected.problems) {
    const declaredBy = (project.scripts ?? []).find((script) => script.name === problem.scriptName);
    if (declaredBy && !attachments.has(declaredBy.id)) continue; // a script nothing uses doesn't block a build
    diagnostics.push({
      severity: "error",
      code: "script-error",
      nodeName: problem.scriptName ? `${problem.scriptName} script` : undefined,
      message: problem.line !== undefined ? `line ${problem.line}: ${problem.message}` : problem.message
    });
  }

  for (const script of project.scripts ?? []) {
    const attached = attachments.get(script.id);
    if (!attached || attached.length === 0) continue;
    // Checked once for each node the script is attached to, with that node as the scope of $Name: a script on several copies of a block finds each copy's own
    // children. Nodes whose checks name the same nodes share one compiled script (one copy of the code, a copy of the variables each); a node that finds
    // different nodes for its $Names is compiled as a script of its own, so in the C a $Name always means one fixed node.
    const groups = new Map<string, { result: ScriptCheckResult; nodes: SceneNode[] }>();
    const { perNode, diagnostics: problems } = checkScriptOnNodes(script.source, project.scene, attached, sceneNames, plan.globals);
    for (const problem of problems) {
      diagnostics.push({
        severity: problem.severity,
        code: problem.severity === "error" ? "script-error" : "script-warning",
        nodeName: `${script.name} script`,
        message: `line ${problem.line}, column ${problem.column}: ${problem.message}`
      });
    }
    for (const { node, result } of perNode) {
      const usage = result.usage;
      plan.touchedIds.add(node.id);
      if (usage.selfWritesTransform) plan.dynamicRootIds.add(node.id);
      if (usage.selfCallsPlay) plan.playedIds.add(node.id);
      if (usage.selfOverlaps) plan.overlapIds.add(node.id);
      if (usage.selfTouch) plan.touchIds.add(node.id);
      if (usage.selfMoves) plan.moveIds.add(node.id);
      if (usage.selfPlaysAnimation) plan.animPlayedIds.add(node.id);
      for (const id of usage.referencedNodeIds) plan.touchedIds.add(id);
      for (const id of usage.nodeWritesTransform) plan.dynamicRootIds.add(id);
      for (const id of usage.nodeCallsPlay) plan.playedIds.add(id);
      for (const id of usage.nodeOverlaps) plan.overlapIds.add(id);
      for (const id of usage.nodeTouch) plan.touchIds.add(id);
      for (const id of usage.nodeMoves) plan.moveIds.add(id);
      for (const id of usage.nodePlaysAnimation) plan.animPlayedIds.add(id);
      const key = JSON.stringify([...result.usage.referencedNodeIds].sort());
      const group = groups.get(key);
      if (group) group.nodes.push(node);
      else groups.set(key, { result, nodes: [node] });
    }
    for (const { result, nodes } of groups.values()) plan.compiled.push({ script, result, attached: nodes });
  }
  return plan;
}
