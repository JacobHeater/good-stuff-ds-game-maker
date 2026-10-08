import {
  DS_HARDWARE_PROFILE,
  DS_MIN_PLAYBACK_HZ,
  dsVolume,
  flattenSceneTreeInOrder,
  danglingInstances,
  expandSceneInstances,
  getAudioPlayer,
  getCollisionShape2D,
  getSpriteAnimations,
  getSpriteFramePixels,
  getSpriteFrames,
  getSpriteTransform,
  getLabel,
  getTileMap,
  isUpright,
  labelCell,
  labelCellOnScreen,
  MAX_LABELS_PER_SCREEN,
  MAX_ROTATING_SPRITES,
  getSoundByteSize,
  getSpritePalette,
  playbackFrequency,
  rawSoundBytes,
  sceneNamesOf,
  TILE_MAP_MAX_COLORS,
  TILE_MAP_MAX_TILES,
  TILE_SIZE,
  type AudioClip,
  type ImportedSound,
  type ImportedSprite,
  type ProjectSnapshot,
  type SceneNode,
  type ScreenId
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import { toF32 } from "./fixed-point";
import { fontSafeText } from "./label-text";
import type { DsAudioClip, DsAudioPlayer, DsCollider2D, DsLabel, DsNode2D, DsScene2D, DsScreen2D, DsSound, DsSprite, DsSpriteAnimation, DsSpriteImage, DsTileMap } from "./ds-scene";
import { generateScriptCode, type CompiledScript } from "./script-codegen";
import { checkProjectScripts, orderGlobalsForRuntime, type TranslateOptions } from "./translate-scene-3d";

export interface TranslateResult2D {
  /** Null exactly when `diagnostics` contains an error. */
  scene: DsScene2D | null;
  diagnostics: Diagnostic[];
}

/** A tile is 8 x 8 pixels. */
const TILE = 8;

/**
 * Reorders a picture's pixels (row by row) into what the DS's sprite engine reads in 1D mapping: 8 x 8 tiles left to right, top
 * to bottom, each tile's 64 pixels row by row. A sprite whose width is 8 is a single column of tiles, and so on.
 */
export function toTileOrder(pixels: Uint8Array, width: number, height: number): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < height / TILE; ty++) {
    for (let tx = 0; tx < width / TILE; tx++) {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) out.push(pixels[(ty * TILE + y) * width + tx * TILE + x]);
      }
    }
  }
  return out;
}

function toImage(sprite: ImportedSprite): DsSpriteImage {
  const palette = getSpritePalette(sprite);
  const { frameWidth, frameHeight, count } = getSpriteFrames(sprite);
  const tiles: number[] = [];
  for (let frame = 0; frame < count; frame++) tiles.push(...toTileOrder(getSpriteFramePixels(sprite, frame), frameWidth, frameHeight));
  const padded = new Array<number>(256).fill(0);
  palette.forEach((color, i) => {
    if (i > 0 && i < 256) padded[i] = color;
  });
  return {
    key: `sprite:${sprite.id}`,
    label: sprite.name,
    width: frameWidth,
    height: frameHeight,
    palette: padded,
    tiles,
    frames: count
  };
}

/**
 * What a 3D project's scripts can do to sprites (a 2D project's ROM runs no scripts). `nodeIndexOf` is a sprite's place in the node table (undefined when it isn't in it),
 * `reachedByScript` says a script is attached to it or names it (the runtime then follows its node every frame, and a hidden one is kept so a script can show it), and
 * `rotatable` says it needs a rotation matrix (it starts rotated or scaled, or a script writes its transform).
 */
export interface SpriteLiveness {
  nodeIndexOf: (node: SceneNode) => number | undefined;
  reachedByScript: (node: SceneNode) => boolean;
  rotatable: (node: SceneNode) => boolean;
}

/**
 * The sprites of a project on each screen, ready for the runtime: the distinct images (once per screen, tile-ordered) and the sprites in hardware order. A `Sprite2D` is
 * drawn centered on its `position` at absolute screen pixels (the 2D viewport places every node at its own position without adding its parents'), and a node is drawn
 * if it is itself visible. Nodes later in the tree are drawn over earlier ones, and the hardware draws the lowest-numbered sprite on top, so each list is the reverse
 * of tree order. `screenOf` says which screen a sprite is on; `used` are the screens that have a sprite engine (the limits are checked for those). Problems (a missing
 * image, too many sprites, palettes or bytes on a screen) and warnings (no image, off the screen) go to `diagnostics`.
 * An `AnimatedSprite2D` is drawn the same way from a sprite sheet (its frames all go into sprite memory, sharing the sheet's palette) and comes with its animations:
 * `fps` is the game's frame rate, which turns an animation's frames a second into how far it goes each game frame.
 * Shared by 2D projects (both screens) and 3D projects (their 2D screen).
 */
export function collectSprites(
  project: ProjectSnapshot,
  screenOf: (node: SceneNode) => ScreenId,
  used: readonly ScreenId[],
  diagnostics: Diagnostic[],
  fps: number,
  live?: SpriteLiveness
): Record<ScreenId, DsScreen2D> {
  const { width: screenWidth, height: screenHeight } = DS_HARDWARE_PROFILE.screens;
  const images = new Map<string, ImportedSprite>((project.sprites ?? []).map((sprite) => [sprite.id, sprite]));

  const screens: Record<ScreenId, { images: DsSpriteImage[]; imageIndex: Map<string, number>; sprites: DsSprite[]; animations: DsSpriteAnimation[]; rotating: number }> = {
    top: { images: [], imageIndex: new Map(), sprites: [], animations: [], rotating: 0 },
    bottom: { images: [], imageIndex: new Map(), sprites: [], animations: [], rotating: 0 }
  };
  const labels = collectLabels(project, screenOf, used, diagnostics, live);

  const ordered = flattenSceneTreeInOrder(project.scene);
  for (const node of ordered) {
    if (node.kind !== "Sprite2D" && node.kind !== "AnimatedSprite2D") continue;
    // A hidden sprite is left out, unless a script can show it (then it starts hidden and the runtime shows it).
    if (!node.visible && !live?.reachedByScript(node)) continue;
    if (node.spriteId === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "sprite-without-image",
        nodeName: node.name,
        message: `This ${node.kind} has no ${node.kind === "Sprite2D" ? "image" : "sprite sheet"}, so nothing is drawn for it. Choose or import one in the Inspector.`
      });
      continue;
    }
    const image = images.get(node.spriteId);
    if (!image) {
      diagnostics.push({
        severity: "error",
        code: "missing-sprite",
        nodeName: node.name,
        message: `This ${node.kind} uses the image "${node.spriteId}", which isn't in the project.`
      });
      continue;
    }

    const rotatable = live?.rotatable(node) ?? false;
    // With a rotation matrix the hardware draws the picture in a box twice its size, centered on the picture, so the corner is a whole picture size further out.
    const frameSize = getSpriteFrames(image);
    const x = rotatable ? Math.round(node.position.x) - frameSize.frameWidth : Math.round(node.position.x - frameSize.frameWidth / 2);
    const y = rotatable ? Math.round(node.position.y) - frameSize.frameHeight : Math.round(node.position.y - frameSize.frameHeight / 2);
    // (A rotating sprite can turn or grow onto the screen, and a script can move any sprite it reaches, so those are never dropped.)
    const droppable = !rotatable && !live?.reachedByScript(node);
    if (droppable && (x + frameSize.frameWidth <= 0 || y + frameSize.frameHeight <= 0 || x >= screenWidth || y >= screenHeight)) {
      diagnostics.push({
        severity: "warning",
        code: "sprite-off-screen",
        nodeName: node.name,
        message: `This sprite is completely outside the ${screenOf(node)} screen (its top-left corner is at ${x}, ${y}), so it isn't drawn.`
      });
      continue;
    }

    // An AnimatedSprite2D's animations: every frame must be in the sheet.
    const animated = node.kind === "AnimatedSprite2D" ? getSpriteAnimations(node) : null;
    const sheetFrames = getSpriteFrames(image).count;
    if (animated) {
      let bad = false;
      for (const animation of animated.animations) {
        const missing = animation.frames.find((frame) => frame >= sheetFrames);
        if (missing !== undefined) {
          diagnostics.push({
            severity: "error",
            code: "animation-frame-out-of-range",
            nodeName: node.name,
            message: `The animation "${animation.name}" shows frame ${missing}, but the sprite sheet "${image.name}" has ${sheetFrames} frame${sheetFrames === 1 ? "" : "s"} (0 to ${sheetFrames - 1}).`
          });
          bad = true;
        }
      }
      if (bad) continue;
      if (animated.animations.length === 0 && sheetFrames > 1) {
        diagnostics.push({
          severity: "warning",
          code: "animated-sprite-without-animations",
          nodeName: node.name,
          message: "This AnimatedSprite2D has no animations, so it shows the first frame of its sheet and never changes. Add one in the Inspector."
        });
      }
    }

    const screen = screens[screenOf(node)];
    let animationFirst = 0;
    let animationStart = -1;
    if (animated) {
      animationFirst = screen.animations.length;
      for (const animation of animated.animations) {
        screen.animations.push({ frames: animation.frames, step: Math.max(1, Math.round((animation.fps * 4096) / fps)), loop: animation.loop });
      }
      const start = animated.start === undefined ? -1 : animated.animations.findIndex((animation) => animation.name === animated.start);
      animationStart = start < 0 ? -1 : animationFirst + start;
    }
    const animationFields = { animation: animationStart, animationFirst, animationCount: animated ? animated.animations.length : 0 };
    let index = screen.imageIndex.get(image.id);
    if (index === undefined) {
      index = screen.images.length;
      screen.images.push(toImage(image));
      screen.imageIndex.set(image.id, index);
    }
    if (live) {
      const dynamic = live.reachedByScript(node);
      const transform = getSpriteTransform(node);
      screen.sprites.push({
        name: node.name,
        image: index,
        x,
        y,
        node: live.nodeIndexOf(node) ?? -1,
        dynamic,
        affine: rotatable ? screen.rotating++ : -1,
        rotation: toF32(transform.rotation),
        scaleX: toF32(transform.scale.x),
        scaleY: toF32(transform.scale.y),
        ...animationFields
      });
    } else {
      screen.sprites.push({ name: node.name, image: index, x, y, ...animationFields });
    }
  }

  for (const id of used) {
    const screen = screens[id];
    const limits = DS_HARDWARE_PROFILE.graphics2D;
    if (screen.sprites.length > limits.oamSpritesPerScreen) {
      diagnostics.push({
        severity: "error",
        code: "too-many-sprites",
        message: `The ${id} screen has ${screen.sprites.length} sprites, but each DS screen can show ${limits.oamSpritesPerScreen}.`
      });
    }
    if (screen.images.length > limits.spritePalettesPerScreen) {
      diagnostics.push({
        severity: "error",
        code: "too-many-sprite-palettes",
        message: `The ${id} screen uses ${screen.images.length} different sprite images, but each DS screen has ${limits.spritePalettesPerScreen} palettes and every image needs its own.`
      });
    }
    if (screen.rotating > MAX_ROTATING_SPRITES) {
      diagnostics.push({
        severity: "error",
        code: "too-many-rotating-sprites",
        message: `The ${id} screen has ${screen.rotating} sprites that rotate or scale (they start rotated or scaled, or a script can change them), but the DS has ${MAX_ROTATING_SPRITES} rotation matrices for a screen.`
      });
    }
    const bytes = screen.images.reduce((sum, image) => sum + image.width * image.height * image.frames, 0);
    if (bytes > limits.spriteMemoryBytesPerScreen) {
      diagnostics.push({
        severity: "error",
        code: "sprite-memory",
        message: `The sprite images on the ${id} screen need ${bytes / 1024} KB of sprite memory, but the DS has ${limits.spriteMemoryBytesPerScreen / 1024} KB for each screen.`
      });
    }
  }


  // Tree order is drawing order (later = on top), and the hardware draws the lowest-numbered sprite on top, so list them the other way round.
  const finish = (id: ScreenId): DsScreen2D => ({ images: screens[id].images, animations: screens[id].animations, sprites: [...screens[id].sprites].reverse(), labels: labels[id] });
  return { top: finish("top"), bottom: finish("bottom") };
}

/**
 * The `Label` nodes on each screen (requirements/scene-designer/STORY.labels-and-text.md): where the first character goes on the 8 x 8 grid, its color and its text. A hidden label is left out
 * unless a script can show it; one whose first cell is off the screen is left out (with a warning) unless a script can reach it; a screen holds only so many.
 */
function collectLabels(
  project: ProjectSnapshot,
  screenOf: (node: SceneNode) => ScreenId,
  used: readonly ScreenId[],
  diagnostics: Diagnostic[],
  live?: SpriteLiveness
): Record<ScreenId, DsLabel[]> {
  const result: Record<ScreenId, DsLabel[]> = { top: [], bottom: [] };
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "Label") continue;
    const reached = live?.reachedByScript(node) ?? false;
    if (!node.visible && !reached) continue;
    const cell = labelCell(node.position);
    if (!labelCellOnScreen(cell) && !reached) {
      diagnostics.push({
        severity: "warning",
        code: "label-off-screen",
        nodeName: node.name,
        message: `This label's first character would be at column ${cell.column}, row ${cell.row}, which is off the ${screenOf(node)} screen (32 columns by 24 rows of 8 pixels), so it isn't drawn.`
      });
      continue;
    }
    const data = getLabel(node);
    result[screenOf(node)].push({
      name: node.name,
      column: cell.column,
      row: cell.row,
      color: data.color,
      text: fontSafeText(data.text),
      ...(live ? { node: live.nodeIndexOf(node) ?? -1, visible: node.visible } : {})
    });
  }
  for (const id of used) {
    if (result[id].length > MAX_LABELS_PER_SCREEN) {
      diagnostics.push({
        severity: "error",
        code: "too-many-labels",
        message: `The ${id} screen has ${result[id].length} labels, but a screen can hold ${MAX_LABELS_PER_SCREEN}.`
      });
    }
  }
  return result;
}

/**
 * Translates a saved 2D project into the description the DS's two 2D engines draw. Pure: no files, no toolchain.
 *
 * A `Sprite2D` is drawn centered on its `position` (as in Godot), at absolute screen pixels: the 2D viewport places every node at its own
 * position without adding its parents', and the ROM matches it. A node is drawn if it is itself visible. Nodes that come later in the tree
 * are drawn over earlier ones. Everything the 2D runtime can't do yet is reported as a diagnostic rather than dropped silently.
 *
 * Scripts run (`STORY.standalone-2d-scripting.md`): checking them and building the global-variable table is exactly `checkProjectScripts`/
 * `orderGlobalsForRuntime`, the same functions `translateScene3D` uses -- neither depends on anything 3D-specific. The node table they
 * decide is simpler than 3D's, since a 2D project has no parent hierarchy to bake: it is just every node a script attaches to or names
 * with `$Name`, in tree order. A capability a 2D ROM can't act on yet (a sound, an AnimationPlayer, switching scenes) still compiles and
 * runs -- the runtime function it calls is a safe no-op there (`runtime2d`'s stubs), exactly like calling `play()` on a player with no
 * sound already is in a 3D project, so a script that reaches for something not built yet never breaks the build or the ROM.
 *
 * See requirements/compiler/STORY.compile-2d-scene-to-nds-rom.md and scene-designer/STORY.standalone-2d-scripting.md.
 */
export function translateScene2D(original: ProjectSnapshot, options: TranslateOptions = {}): TranslateResult2D {
  const diagnostics: Diagnostic[] = [];
  // An instance of a scene is replaced by that scene's nodes before anything else looks at the tree.
  const project: ProjectSnapshot = { ...original, scene: expandSceneInstances(original, original.scene) };
  for (const node of danglingInstances(original, original.scene)) {
    diagnostics.push({ severity: "warning", code: "scene-instance-missing", nodeName: node.name, message: "This node is an instance of a scene that isn't in the project any more, so nothing is drawn for it." });
  }

  if (project.mode !== "2D") {
    diagnostics.push({ severity: "error", code: "not-a-2d-project", message: "Only 2D projects can be compiled as 2D; this is a 3D project." });
    return { scene: null, diagnostics };
  }

  if ((project.scenes ?? []).length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "extra-scenes-not-built",
      message: `This project has ${project.scenes!.length + 1} scenes, so a script's change_scene() compiles, but nothing is actually there to switch to yet: only the starting scene is in the ROM. The others are saved with the project.`
    });
  }

  // Scripts first, exactly as translateScene3D does: they decide which nodes need a place in the node table.
  const scripts = checkProjectScripts(project, diagnostics, options.sceneNames ?? sceneNamesOf(project));
  const globals = orderGlobalsForRuntime(scripts.globals);

  // Each screen's camera (requirements/scene-designer/STORY.standalone-2d-camera.md): the first Camera2D on it, in tree order.
  // It always needs a node-table place, whether or not a script ever moves it (its starting position already matters); every
  // sprite on that screen is treated as reached by a script too, since its drawn position now depends on the camera's.
  const cameraByScreen = new Map<ScreenId, SceneNode>();
  const extraCameras: SceneNode[] = [];
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "Camera2D") continue;
    if (cameraByScreen.has(node.screen)) extraCameras.push(node);
    else cameraByScreen.set(node.screen, node);
  }
  for (const node of extraCameras) {
    diagnostics.push({
      severity: "warning",
      code: "multiple-cameras",
      nodeName: node.name,
      message: `This screen already has a Camera2D (${cameraByScreen.get(node.screen)!.name}); the first one in the tree is used, so this one does nothing.`
    });
  }
  const hasCamera = (screen: ScreenId): boolean => cameraByScreen.has(screen);
  // Only a Sprite2D/AnimatedSprite2D's drawn position actually depends on the camera (and the camera node itself always
  // needs a node-table place, for topCamera/bottomCamera and for follow_sprite to read its live position). A TileMap's
  // scroll depends on the camera the same way a sprite's position does (STORY.standalone-2d-tilemaps.md), so it's reached
  // too. A group, label, collision shape or audio player merely sharing a screen with a camera isn't swept in by that
  // alone -- it still needs a script to reach it, exactly as before this story.
  const reachedByCamera = (node: SceneNode): boolean =>
    hasCamera(node.screen) && (node.kind === "Sprite2D" || node.kind === "AnimatedSprite2D" || node.kind === "Camera2D" || node.kind === "TileMap");
  const reached = (node: SceneNode): boolean => scripts.touchedIds.has(node.id) || reachedByCamera(node);

  const nodeTable = flattenSceneTreeInOrder(project.scene).filter(reached);
  const nodeIndexOf = new Map(nodeTable.map((node, index) => [node.id, index]));

  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "Sprite2D" && node.kind !== "AnimatedSprite2D" && node.kind !== "AudioStreamPlayer" && node.kind !== "CollisionShape2D" && node.kind !== "Camera2D" && node.kind !== "TileMap") {
      warnUnbuilt(node, diagnostics);
    }
  }
  const fps = options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget;
  const screens = collectSprites(project, (node) => node.screen, ["top", "bottom"], diagnostics, fps, {
    nodeIndexOf: (node) => nodeIndexOf.get(node.id),
    reachedByScript: reached,
    // Rotation and scale need a rotation matrix: a sprite that starts turned or scaled, or one whose transform a script writes.
    rotatable: (node) => !isUpright(getSpriteTransform(node)) || scripts.dynamicRootIds.has(node.id)
  });
  const audio = collectAudio(project, diagnostics, scripts.playedIds, nodeIndexOf);
  const colliders = collectCollision2D(project, diagnostics, scripts.overlapIds, nodeIndexOf);
  const tileMaps = collectTileMaps(project, diagnostics, nodeIndexOf);

  if (hasErrors(diagnostics)) return { scene: null, diagnostics };

  const nodes: DsNode2D[] = nodeTable.map((node) => {
    const transform = getSpriteTransform(node);
    return {
      name: node.name,
      // The same slots a 3D project's node table gives a Sprite2D/Label: position x, y in pixels (f32), the angle (degrees,
      // clockwise) in the third rotation slot, scale x, y -- see translate-scene-3d.ts's own dsNodes construction.
      position: [toF32(node.position.x), toF32(node.position.y), 0],
      rotation: [0, 0, toF32(transform.rotation)],
      scale: [toF32(transform.scale.x), toF32(transform.scale.y), toF32(1)],
      visible: node.visible
    };
  });
  const compiledScripts: CompiledScript[] = scripts.compiled.map(({ script, result, attached }) => ({
    name: script.name,
    program: result.program,
    instances: attached.map((node) => nodeIndexOf.get(node.id)!).sort((a, b) => a - b)
  }));
  const scriptCode = generateScriptCode(compiledScripts, nodeIndexOf, "", new Map(globals.map((g, i) => [g.name, i])));

  return {
    scene: {
      fps,
      top: screens.top,
      bottom: screens.bottom,
      nodes,
      globals: globals.map((g) => ({
        name: g.name,
        type: g.type,
        value: g.type === "float" ? toF32(g.initial as number) : g.type === "string" ? fontSafeText(g.initial as string) : g.initial
      })),
      scriptCode,
      sounds: audio.sounds,
      audioPlayers: audio.audioPlayers,
      audioClips: audio.audioClips,
      colliders,
      tileMaps,
      topCamera: cameraByScreen.has("top") ? (nodeIndexOf.get(cameraByScreen.get("top")!.id) ?? -1) : -1,
      bottomCamera: cameraByScreen.has("bottom") ? (nodeIndexOf.get(cameraByScreen.get("bottom")!.id) ?? -1) : -1
    },
    diagnostics
  };
}

/**
 * CollisionShape2D nodes a script can reach (requirements/scene-designer/STORY.standalone-2d-collision.md): a rect's half
 * extents or a circle's radius, in f32 pixels. Only a shape in the node table (`nodeIndexOf`, so a script attaches to it or
 * names it) gets a collider -- one nothing reaches is never in the ROM at all. `overlapIds` are the shapes a script actually
 * passes to `overlaps()`; one that's reachable but never actually checked still gets a collider (a script might read its
 * position, say) but also a `collision-shape-unused` warning, the same message a 3D project's unused shape gets.
 */
function collectCollision2D(
  project: ProjectSnapshot,
  diagnostics: Diagnostic[],
  overlapIds: ReadonlySet<string>,
  nodeIndexOf: ReadonlyMap<string, number>
): DsCollider2D[] {
  const colliders: DsCollider2D[] = [];
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "CollisionShape2D") continue;
    const index = nodeIndexOf.get(node.id);
    if (index === undefined) continue; // nothing reaches it: it does nothing, and warnUnbuilt doesn't apply to it either (it's a real kind now, just unused)
    if (!overlapIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        code: "collision-shape-unused",
        nodeName: node.name,
        message: "No script passes this collision shape to overlaps(), so it does nothing in the game."
      });
    }
    const shape = getCollisionShape2D(node);
    colliders.push({
      name: node.name,
      shape: shape.shape,
      p: shape.shape === "rect" ? [toF32(shape.size.x / 2), toF32(shape.size.y / 2)] : [toF32(shape.radius), 0],
      node: index
    });
  }
  return colliders;
}

/**
 * AudioStreamPlayers, their sounds and their named clips -- the same rules `translateScene3D` uses (`player-without-sound`,
 * `missing-sound`, `sound-pitch-clamped`, `sound-not-started`, `too-many-sounds`, `sound-memory`), just without a parent-
 * chain visibility to factor in (a 2D node's own `.visible` already decides whether it is drawn or started). `nodeIndexOf`
 * gives a script-reached player a place in the node table, for `gs_node_audio_player` to find it by.
 */
function collectAudio(
  project: ProjectSnapshot,
  diagnostics: Diagnostic[],
  playedIds: ReadonlySet<string>,
  nodeIndexOf: ReadonlyMap<string, number>
): { sounds: DsSound[]; audioPlayers: DsAudioPlayer[]; audioClips: DsAudioClip[] } {
  const playablePlayers: Array<{
    node: SceneNode;
    sound: ImportedSound | null;
    clips: Array<{ clip: AudioClip; sound: ImportedSound }>;
    settings: ReturnType<typeof getAudioPlayer>;
    startsAtOnce: boolean;
  }> = [];
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "AudioStreamPlayer") continue;
    const settings = getAudioPlayer(node);
    const hasOwnSound = settings.soundId !== undefined;
    if (!hasOwnSound && (settings.clips?.length ?? 0) === 0) {
      diagnostics.push({ severity: "warning", code: "player-without-sound", nodeName: node.name, message: "This audio player has no sound assigned, so it was left out." });
      continue;
    }
    let sound: ImportedSound | null = null;
    if (hasOwnSound) {
      sound = project.sounds?.find((candidate) => candidate.id === settings.soundId) ?? null;
      if (!sound) {
        diagnostics.push({ severity: "error", code: "missing-sound", nodeName: node.name, message: "This audio player uses a sound that isn't in the project, so there is nothing to play. Import the sound again or clear it." });
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
    if (hasOwnSound && !settings.autoplay && !playedIds.has(node.id)) {
      diagnostics.push({
        severity: "warning",
        code: "sound-not-started",
        nodeName: node.name,
        message: "Autoplay is off and no script calls play() on this player, so nothing starts this sound; it stays silent."
      });
    }
    // A player starts by itself only if it has its own sound, Autoplay on, and is visible as the scene stands.
    playablePlayers.push({ node, sound, clips, settings, startsAtOnce: hasOwnSound && settings.autoplay && node.visible });
  }
  const autoplaying = playablePlayers.filter(({ startsAtOnce }) => startsAtOnce).length;
  const channels = DS_HARDWARE_PROFILE.audio.channels;
  if (autoplaying > channels) {
    diagnostics.push({ severity: "error", code: "too-many-sounds", message: `${autoplaying} audio players start at once, but the DS has ${channels} sound channels.` });
  }
  const usedSounds = new Map<string, ImportedSound>();
  for (const { sound, clips } of playablePlayers) {
    if (sound) usedSounds.set(sound.id, sound);
    for (const { sound: clipSound } of clips) usedSounds.set(clipSound.id, clipSound);
  }
  const soundBytes = [...usedSounds.values()].reduce((sum, sound) => sum + getSoundByteSize(sound), 0);
  const soundLimit = DS_HARDWARE_PROFILE.audio.soundMemoryBytes;
  if (soundBytes > soundLimit) {
    diagnostics.push({ severity: "error", code: "sound-memory", message: `The scene's sounds need ${soundBytes} bytes and a game can use ${soundLimit} bytes of the DS's RAM for sound.` });
  }

  const sounds: DsSound[] = [];
  const soundIndex = new Map<string, number>();
  const indexOfSound = (sound: ImportedSound): number => {
    let index = soundIndex.get(sound.id);
    if (index === undefined) {
      const bytes = Array.from(rawSoundBytes(sound));
      while (bytes.length % 4 !== 0) bytes.push(0);
      const format = sound.format === "ima-adpcm" ? "ima-adpcm" : "pcm16";
      sounds.push({ key: `sound:${sound.id}`, label: sound.name, sampleRate: sound.sampleRate, format, bytes });
      index = sounds.length - 1;
      soundIndex.set(sound.id, index);
    }
    return index;
  };
  const audioClips: DsAudioClip[] = [];
  const audioPlayers: DsAudioPlayer[] = playablePlayers.map(({ node, sound, clips, settings, startsAtOnce }) => {
    const soundIndex = sound ? indexOfSound(sound) : -1;
    const clipStart = audioClips.length;
    for (const { clip, sound: clipSound } of clips) {
      audioClips.push({ sound: indexOfSound(clipSound), volume: dsVolume(clip.volume), frequency: playbackFrequency(clipSound.sampleRate, clip.pitch).hz, loop: clip.loop });
    }
    return {
      sound: soundIndex,
      volume: sound ? dsVolume(settings.volume) : 0,
      frequency: sound ? playbackFrequency(sound.sampleRate, settings.pitch).hz : DS_MIN_PLAYBACK_HZ,
      loop: settings.loop,
      autoplay: startsAtOnce,
      clipStart,
      clipCount: clips.length,
      node: nodeIndexOf.get(node.id) ?? -1
    };
  });
  return { sounds, audioPlayers, audioClips };
}

/** 64 palette-index pixels (one tile, row by row) as 32 nibble-packed bytes (two pixels a byte, low nibble first) -- the DS background hardware's own 4bpp tile format. */
function packNibbleTile(pixels: Uint8Array): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < pixels.length; i += 2) bytes.push((pixels[i] & 0xf) | ((pixels[i + 1] ?? 0) << 4));
  return bytes;
}

/**
 * Every TileMap with a sheet chosen (requirements/scene-designer/STORY.standalone-2d-tilemaps.md): its tile graphics (4bpp,
 * nibble-packed, tile 0 reserved as a fully transparent blank for an empty cell -- a sheet's own frame N is physical tile
 * N + 1), its grid of physical tile indices, and which *sheet frames* are solid ground. A TileMap with no sheet chosen yet
 * draws nothing, quietly, the same as a Sprite2D with no image. The sheet is an ordinary imported sprite sheet (`getTileMap`'s
 * `spriteId`, 8 x 8 frames) -- imported, stored and read exactly like an AnimatedSprite2D's, since a tile is just a frame.
 */
function collectTileMaps(project: ProjectSnapshot, diagnostics: Diagnostic[], nodeIndexOf: ReadonlyMap<string, number>): DsTileMap[] {
  const sheets = new Map<string, ImportedSprite>((project.sprites ?? []).map((sprite) => [sprite.id, sprite]));
  const tileMaps: DsTileMap[] = [];
  const usedScreens = new Set<ScreenId>();
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "TileMap") continue;
    // One screen, one tile layer (the runtime has a single background layer for it) -- the first TileMap on a screen, in
    // tree order, wins, the same rule a screen's camera already uses.
    if (usedScreens.has(node.screen)) {
      diagnostics.push({
        severity: "warning",
        code: "multiple-tilemaps",
        nodeName: node.name,
        message: `The ${node.screen} screen already has a TileMap; the first one in the tree is used, so this one does nothing.`
      });
      continue;
    }
    usedScreens.add(node.screen);
    const data = getTileMap(node);
    if (data.spriteId === undefined) {
      diagnostics.push({ severity: "warning", code: "tilemap-without-sheet", nodeName: node.name, message: "This TileMap has no tile sheet, so nothing is drawn for it. Import one in the Inspector." });
      continue;
    }
    const sheet = sheets.get(data.spriteId);
    if (!sheet) {
      diagnostics.push({ severity: "error", code: "missing-sprite", nodeName: node.name, message: `This TileMap uses the sheet "${data.spriteId}", which isn't in the project.` });
      continue;
    }
    const frames = getSpriteFrames(sheet);
    if (frames.frameWidth !== TILE_SIZE || frames.frameHeight !== TILE_SIZE) {
      diagnostics.push({
        severity: "error",
        code: "tileset-wrong-frame-size",
        nodeName: node.name,
        message: `This TileMap's sheet is a grid of ${frames.frameWidth} x ${frames.frameHeight} pictures, but a tile is always ${TILE_SIZE} x ${TILE_SIZE}. Import it again with that frame size.`
      });
      continue;
    }
    if (frames.count > TILE_MAP_MAX_TILES) {
      diagnostics.push({
        severity: "error",
        code: "tileset-too-many-tiles",
        nodeName: node.name,
        message: `This TileMap's sheet has ${frames.count} tiles, but the runtime has room for ${TILE_MAP_MAX_TILES} distinct tiles on one screen. Use a smaller sheet.`
      });
      continue;
    }
    const palette = getSpritePalette(sheet);
    if (palette.length - 1 > TILE_MAP_MAX_COLORS) {
      diagnostics.push({
        severity: "error",
        code: "tileset-too-many-colors",
        nodeName: node.name,
        message: `This TileMap's sheet has ${palette.length - 1} colors, but a tile layer's background hardware only has ${TILE_MAP_MAX_COLORS} (plus transparent) -- a sprite's own, independent palette is bigger. Reduce its colors and import it again.`
      });
      continue;
    }
    const tiles: number[] = new Array(32).fill(0); // physical tile 0: the reserved, fully transparent blank
    for (let frame = 0; frame < frames.count; frame++) tiles.push(...packNibbleTile(getSpriteFramePixels(sheet, frame)));
    const paletteOut = new Array(16).fill(0);
    for (let i = 0; i < palette.length && i < 16; i++) paletteOut[i] = palette[i];
    tileMaps.push({
      name: node.name,
      screen: node.screen,
      columns: data.columns,
      rows: data.rows,
      palette: paletteOut,
      tiles,
      tileCount: frames.count + 1,
      // A cell's tile index is a *sheet frame*; the physical slot it occupies (reserved blank aside) is one more than that.
      cells: data.tiles.map((tile) => (tile >= 0 && tile < frames.count ? tile + 1 : 0)),
      solid: data.solid,
      node: nodeIndexOf.get(node.id) ?? -1
    });
  }
  return tileMaps;
}

/** What a 2D ROM doesn't draw or run yet. Groups (Node2D) and shapes that draw nothing stay quiet. */
function warnUnbuilt(node: SceneNode, diagnostics: Diagnostic[]): void {
  switch (node.kind) {
    case "AnimationPlayer":
    case "TouchArea2D":
      diagnostics.push({
        severity: "warning",
        code: "two-d-node-not-built",
        nodeName: node.name,
        message: `The 2D ROM doesn't support ${node.kind} yet, so it does nothing there. It is saved with the project.`
      });
      break;
    default:
      break;
  }
}
