import {
  DS_HARDWARE_PROFILE,
  flattenSceneTreeInOrder,
  danglingInstances,
  expandSceneInstances,
  getSpriteAnimations,
  getSpriteFramePixels,
  getSpriteFrames,
  getSpriteTransform,
  getLabel,
  labelCell,
  labelCellOnScreen,
  MAX_LABELS_PER_SCREEN,
  MAX_ROTATING_SPRITES,
  getSpritePalette,
  type ImportedSprite,
  type ProjectSnapshot,
  type SceneNode,
  type ScreenId
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import { toF32 } from "./fixed-point";
import { fontSafeText } from "./label-text";
import type { DsLabel, DsScene2D, DsScreen2D, DsSprite, DsSpriteAnimation, DsSpriteImage } from "./ds-scene";
import type { TranslateOptions } from "./translate-scene-3d";

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
 * See requirements/compiler/STORY.compile-2d-scene-to-nds-rom.md.
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
      message: `This project has ${project.scenes!.length + 1} scenes, but a 2D ROM runs no scripts, so nothing can switch scenes: only the starting scene is in the ROM. The others are saved with the project.`
    });
  }
  const ordered = flattenSceneTreeInOrder(project.scene);
  for (const node of ordered) {
    if (node.scriptId !== undefined) {
      diagnostics.push({
        severity: "warning",
        code: "two-d-scripts-not-built",
        nodeName: node.name,
        message: "This node has a script, but the ROM doesn't run scripts in 2D projects yet, so it does nothing there. It is saved with the project."
      });
    }
    if (node.kind !== "Sprite2D" && node.kind !== "AnimatedSprite2D") warnUnbuilt(node, diagnostics);
  }
  const fps = options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget;
  const screens = collectSprites(project, (node) => node.screen, ["top", "bottom"], diagnostics, fps);

  if (hasErrors(diagnostics)) return { scene: null, diagnostics };

  return { scene: { fps, top: screens.top, bottom: screens.bottom }, diagnostics };
}

/** What a 2D ROM doesn't draw or run yet. Groups (Node2D) and shapes that draw nothing stay quiet. */
function warnUnbuilt(node: SceneNode, diagnostics: Diagnostic[]): void {
  switch (node.kind) {
    case "TileMap":
    case "AudioStreamPlayer":
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
