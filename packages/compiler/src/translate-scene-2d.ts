import {
  DS_HARDWARE_PROFILE,
  DS_MIN_PLAYBACK_HZ,
  dsVolume,
  findSceneNode,
  flattenSceneTree,
  flattenSceneTreeInOrder,
  danglingInstances,
  expandSceneInstances,
  expandSpawnPools,
  getAudioPlayer,
  getCollisionShape2D,
  getInventory,
  inventorySlotSize,
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
  nestedSpawnPools,
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
  type ScreenId,
  type SpawnPoolExpansion
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import { toF32 } from "./fixed-point";
import { fontSafeText } from "./label-text";
import type { DsAudioClip, DsAudioPlayer, DsCollider2D, DsInventory, DsLabel, DsNode2D, DsScene2D, DsScreen2D, DsSound, DsSpawnPool, DsSprite, DsSpriteAnimation, DsSpriteImage, DsTileMap } from "./ds-scene";
import { generateScriptCode, type CompiledScript } from "./script-codegen";
import { checkProjectScripts, compileInventoryItems, orderGlobalsForRuntime, type TranslateOptions } from "./translate-scene-3d";

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

/** One screen's own sprite data, still being built up (`collectSprites`'s own local accumulator, shared with `collectInventoryPanel` so a panel's sprites land in the exact same arrays an ordinary Sprite2D/AnimatedSprite2D already does -- OAM ids and palette slots are allocated purely by array position at runtime, so there is only ever one real table to share, never a separate one). */
interface ScreenBuild {
  images: DsSpriteImage[];
  imageIndex: Map<string, number>;
  sprites: DsSprite[];
  animations: DsSpriteAnimation[];
  rotating: number;
}

/** `image`'s own place in `screen.images` (its sheet already there, or freshly added and deduped by id, the same as any other screen sprite's own image). */
function indexOfImage(screen: ScreenBuild, image: ImportedSprite): number {
  let index = screen.imageIndex.get(image.id);
  if (index === undefined) {
    index = screen.images.length;
    screen.images.push(toImage(image));
    screen.imageIndex.set(image.id, index);
  }
  return index;
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

/** What `collectSprites` found for one Inventory node's own on-screen panel (STORY.inventory-ui-panel.md): everything `DsInventory` needs except `node`/`slots`, added once the node's own place in the node table is known. */
export type InventoryPanelFields = Omit<DsInventory, "node" | "slots">;

/**
 * The sprites of a project on each screen, ready for the runtime: the distinct images (once per screen, tile-ordered) and the sprites in hardware order. A `Sprite2D` is
 * drawn centered on its `position` at absolute screen pixels (the 2D viewport places every node at its own position without adding its parents'), and a node is drawn
 * if it is itself visible. Nodes later in the tree are drawn over earlier ones, and the hardware draws the lowest-numbered sprite on top, so each list is the reverse
 * of tree order. `screenOf` says which screen a sprite is on; `used` are the screens that have a sprite engine (the limits are checked for those). Problems (a missing
 * image, too many sprites, palettes or bytes on a screen) and warnings (no image, off the screen) go to `diagnostics`.
 * An `AnimatedSprite2D` is drawn the same way from a sprite sheet (its frames all go into sprite memory, sharing the sheet's palette) and comes with its animations:
 * `fps` is the game's frame rate, which turns an animation's frames a second into how far it goes each game frame.
 * Shared by 2D projects (both screens) and 3D projects (their 2D screen) -- as is `inventoryPanels` (STORY.inventory-ui-panel.md): an Inventory node with at least one of
 * its own panel images set gets its background/slot-frame/highlight/item-icon sprites (drawn in that order, so the highlight never hides an item's own icon) folded into these same per-screen arrays (not a table of their own -- see
 * `InventoryPanelFields`'s own comment for why), and its stack-count labels folded into this same call's own `labels`.
 */
export function collectSprites(
  project: ProjectSnapshot,
  screenOf: (node: SceneNode) => ScreenId,
  used: readonly ScreenId[],
  diagnostics: Diagnostic[],
  fps: number,
  live?: SpriteLiveness
): { screens: Record<ScreenId, DsScreen2D>; inventoryPanels: Map<string, InventoryPanelFields> } {
  const { width: screenWidth, height: screenHeight } = DS_HARDWARE_PROFILE.screens;
  const images = new Map<string, ImportedSprite>((project.sprites ?? []).map((sprite) => [sprite.id, sprite]));

  const screens: Record<ScreenId, ScreenBuild> = {
    top: { images: [], imageIndex: new Map(), sprites: [], animations: [], rotating: 0 },
    bottom: { images: [], imageIndex: new Map(), sprites: [], animations: [], rotating: 0 }
  };
  const labels = collectLabels(project, screenOf, diagnostics, live);
  // Raw (pre-reversal) sprite indices, by node id and screen; the real indices aren't known until every node's own
  // sprites are pushed and the whole-screen reversal below has happened (see the remap just before `finish`).
  const rawPanels: Array<{ id: string; screen: ScreenId; fields: InventoryPanelFields }> = [];

  const ordered = flattenSceneTreeInOrder(project.scene);
  for (const node of ordered) {
    if (node.kind === "Inventory") {
      // The exact same gate collectInventory2D itself uses ("nothing reaches it, nothing is built" -- an Inventory
      // no script ever names or attaches to can never add/remove/query anything, panel or not), so a panel's own
      // sprites/labels are never compiled with no DsInventory entry left to reference them.
      if (!live || live.nodeIndexOf(node) === undefined) continue;
      const panel = collectInventoryPanel(node, project, images, screens[screenOf(node)], labels[screenOf(node)], screenOf(node), diagnostics);
      if (panel) rawPanels.push({ id: node.id, screen: screenOf(node), fields: panel });
      continue;
    }
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
    const index = indexOfImage(screen, image);
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
    // Checked here, not inside collectLabels, now that an Inventory panel's own stack-count labels (above) have had
    // their chance to add to the same screen's own count.
    if (labels[id].length > MAX_LABELS_PER_SCREEN) {
      diagnostics.push({
        severity: "error",
        code: "too-many-labels",
        message: `The ${id} screen has ${labels[id].length} labels, but a screen can hold ${MAX_LABELS_PER_SCREEN}.`
      });
    }
  }

  // Tree order is drawing order (later = on top), and the hardware draws the lowest-numbered sprite on top, so the
  // whole screen's own sprites are listed the other way round from how they were collected -- which is also why a
  // panel's own raw (collection-order) sprite indices, recorded above, aren't the real ones until this has happened:
  // an index `i` into the pre-reversal array ends up at `sprites.length - 1 - i` once it has. A panel's own `*Start`
  // fields always point at slot 0 specifically (not the lowest slot number), so finding slot `n`'s own sprite from
  // one is `*Start - n`, not `+ n` -- the same reversal that moves a single sprite's index also reverses the order
  // of every run pushed together, the same direction as everything else.
  const remapIndex = (id: ScreenId, raw: number): number => (raw === -1 ? -1 : screens[id].sprites.length - 1 - raw);
  const inventoryPanels = new Map<string, InventoryPanelFields>(
    rawPanels.map(({ id, screen, fields }) => [
      id,
      {
        ...fields,
        backgroundSprite: remapIndex(screen, fields.backgroundSprite),
        slotSpriteStart: remapIndex(screen, fields.slotSpriteStart),
        iconSpriteStart: remapIndex(screen, fields.iconSpriteStart),
        highlightSprite: remapIndex(screen, fields.highlightSprite)
      }
    ])
  );

  const finish = (id: ScreenId): DsScreen2D => ({ images: screens[id].images, animations: screens[id].animations, sprites: [...screens[id].sprites].reverse(), labels: labels[id] });
  return { screens: { top: finish("top"), bottom: finish("bottom") }, inventoryPanels };
}

/**
 * One Inventory node's own on-screen panel (STORY.inventory-ui-panel.md), if it has one configured -- at least one
 * of its own background/slot/highlight images is set (undefined otherwise: nothing drawn, the same as a Sprite2D
 * with no image chosen). The panel's background is one static sprite at this node's own position; the slot frames
 * (if a slot image is set), the highlight (if set, repositioned by the runtime to whichever slot was last
 * touched) and the item icons (if the project has an icon sheet) are pushed in that order -- background, slot
 * frames, highlight, icons -- not background/slot/icon/highlight: a sprite pushed later ends up drawn on top
 * (`collectSprites`'s own reversal), and an item's own icon has to stay visible on a selected, filled slot, not
 * be hidden underneath the highlight. Every sprite here is pushed into `screen` directly -- the exact same
 * per-screen table an ordinary Sprite2D/AnimatedSprite2D already shares (see `collectSprites`'s own comment on
 * why this can't be a table of its own) -- and every stack-count label into `labels`, the same way. The indices
 * this returns are raw (collection order); `collectSprites` remaps them once the whole screen's own sprites are
 * known and reversed.
 */
function collectInventoryPanel(
  node: SceneNode,
  project: ProjectSnapshot,
  images: ReadonlyMap<string, ImportedSprite>,
  screen: ScreenBuild,
  labels: DsLabel[],
  screenId: ScreenId,
  diagnostics: Diagnostic[]
): InventoryPanelFields | undefined {
  const data = getInventory(node);
  if (data.backgroundSpriteId === undefined && data.slotSpriteId === undefined && data.highlightSpriteId === undefined) return undefined;

  const resolve = (spriteId: string | undefined, what: string): ImportedSprite | undefined => {
    if (spriteId === undefined) return undefined;
    const image = images.get(spriteId);
    if (!image) {
      diagnostics.push({ severity: "error", code: "missing-sprite", nodeName: node.name, message: `This Inventory's own ${what} image uses "${spriteId}", which isn't in the project.` });
    }
    return image;
  };
  const background = resolve(data.backgroundSpriteId, "background");
  const slotImage = resolve(data.slotSpriteId, "slot");
  const highlight = resolve(data.highlightSpriteId, "highlight");
  // Never reported as an error here: a project-wide field validated once already (JsonSchemaProjectSnapshotValidator), and this engine's own established
  // permissive handling for it (compileInventoryItems never resolves it either) -- a dangling or absent icon sheet just means no icons are drawn.
  const iconSheet = project.itemIconsSpriteId === undefined ? undefined : images.get(project.itemIconsSpriteId);

  const { slots, columns, slotSpacingX: spacingX, slotSpacingY: spacingY } = data;
  const { width: slotWidth, height: slotHeight } = inventorySlotSize(slotImage, iconSheet);
  const panelX = Math.round(node.position.x);
  const panelY = Math.round(node.position.y);
  const cellX = (slot: number): number => panelX + (slot % columns) * (slotWidth + spacingX);
  const cellY = (slot: number): number => panelY + Math.floor(slot / columns) * (slotHeight + spacingY);
  const blank = { animation: -1, animationFirst: 0, animationCount: 0 };

  const backgroundSprite = background ? screen.sprites.push({ name: `${node.name} background`, image: indexOfImage(screen, background), x: panelX, y: panelY, ...blank }) - 1 : -1;

  let slotSpriteStart = -1;
  if (slotImage) {
    slotSpriteStart = screen.sprites.length;
    for (let slot = 0; slot < slots; slot++) {
      screen.sprites.push({ name: `${node.name} slot ${slot}`, image: indexOfImage(screen, slotImage), x: cellX(slot), y: cellY(slot), ...blank });
    }
  }

  // The highlight is pushed before the icons, not after: a sprite pushed later ends up drawn on top (same rule as
  // everywhere else -- see collectSprites's own comment on the reversal), and an icon has to stay visible on a
  // selected, filled slot, not be covered by the highlight underneath it. (Drawn in between the slot frame and the
  // icon, so an empty selected slot still shows the highlight clearly, over the frame.)
  const highlightSprite = highlight ? screen.sprites.push({ name: `${node.name} highlight`, image: indexOfImage(screen, highlight), x: cellX(0), y: cellY(0), ...blank }) - 1 : -1;

  // Item icons and the stack-count labels are the panel's actual content, so they're part of it whenever a panel exists at
  // all (one of the three images above is set) -- not gated on their own image/project field separately existing.
  let iconSpriteStart = -1;
  if (iconSheet) {
    iconSpriteStart = screen.sprites.length;
    for (let slot = 0; slot < slots; slot++) {
      screen.sprites.push({ name: `${node.name} icon ${slot}`, image: indexOfImage(screen, iconSheet), x: cellX(slot), y: cellY(slot), ...blank });
    }
  }

  // One label per slot, positioned at its own slot's top-left corner (rounded to the nearest 8-pixel text cell, the
  // same rounding labelCell uses), text fixed at compile time ("x{}", the value filling in the count) -- hidden to
  // start (every slot is empty), since the runtime toggles whether it shows at all once a frame from its slot's
  // own live count (STORY.inventory-ui-panel.md: hidden for 0 or 1, "x3" style shown above that), the same
  // shown/dirty mechanism an ordinary Label's own visibility already uses, not a change of text.
  const labelStart = labels.length;
  for (let slot = 0; slot < slots; slot++) {
    labels.push({ name: `${node.name} count ${slot}`, column: Math.round(cellX(slot) / 8), row: Math.round(cellY(slot) / 8), color: 7, text: "x{}", visible: false });
  }

  return { panelX, panelY, columns, slotWidth, slotHeight, spacingX, spacingY, backgroundSprite, slotSpriteStart, iconSpriteStart, highlightSprite, labelStart, screen: screenId };
}

/**
 * The `Label` nodes on each screen (requirements/scene-designer/STORY.labels-and-text.md): where the first character goes on the 8 x 8 grid, its color and its text. A hidden label is left out
 * unless a script can show it; one whose first cell is off the screen is left out (with a warning) unless a script can reach it. The budget (`MAX_LABELS_PER_SCREEN`) is checked by the caller
 * (`collectSprites`), not here, since an Inventory panel's own stack-count labels (STORY.inventory-ui-panel.md) are appended into this same result afterward and need to count toward it too.
 */
function collectLabels(project: ProjectSnapshot, screenOf: (node: SceneNode) => ScreenId, diagnostics: Diagnostic[], live?: SpriteLiveness): Record<ScreenId, DsLabel[]> {
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
  // A spawn pool (STORY.spawn-pools.md) becomes N ordinary instance nodes first, then an instance of a scene --
  // pool or plain -- is replaced by that scene's own nodes, before anything else looks at the tree.
  const spawnPools = expandSpawnPools(original, original.scene);
  const project: ProjectSnapshot = { ...original, scene: expandSceneInstances(original, spawnPools.tree) };
  for (const node of danglingInstances(original, original.scene)) {
    diagnostics.push({ severity: "warning", code: "scene-instance-missing", nodeName: node.name, message: "This node is an instance of a scene that isn't in the project any more, so nothing is drawn for it." });
  }
  for (const node of nestedSpawnPools(original, original.scene)) {
    diagnostics.push({ severity: "error", code: "nested-spawn-pool", nodeName: node.name, message: "This spawn pool's own scene already contains a spawn pool of its own (directly, or through an instance), which isn't supported -- a pool can't itself contain a pool." });
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
  const scripts = checkProjectScripts(project, diagnostics, options.sceneNames ?? sceneNamesOf(project), spawnPools.pools.map((p) => p.name), 2);
  const globals = orderGlobalsForRuntime(scripts.globals);

  // A spawn pool's own copies need a node-table place and live position/visible tracking even though nothing in
  // the authored scene scripts or $Name-references them -- the whole point is a script spawning/despawning them
  // later. Unlike 3D (whose world transforms cascade from a dynamic parent, so only each copy's own root needs
  // this), 2D nodes never compose a parent's position into a child's (STORY.spawn-pools.md), so every node of
  // every copy, not just its root, needs its own real node-table index.
  for (const pool of spawnPools.pools) {
    for (const rootId of pool.copyRootIds) {
      const copyRoot = findSceneNode(project.scene, rootId);
      if (!copyRoot) continue; // the pool itself was refused (nestedSpawnPools) -- its copies were never expanded
      for (const node of flattenSceneTree(copyRoot)) scripts.touchedIds.add(node.id);
    }
  }

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
    if (node.kind !== "Sprite2D" && node.kind !== "AnimatedSprite2D" && node.kind !== "AudioStreamPlayer" && node.kind !== "CollisionShape2D" && node.kind !== "Camera2D" && node.kind !== "TileMap" && node.kind !== "Inventory") {
      warnUnbuilt(node, diagnostics);
    }
  }
  const fps = options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget;
  const { screens, inventoryPanels } = collectSprites(project, (node) => node.screen, ["top", "bottom"], diagnostics, fps, {
    nodeIndexOf: (node) => nodeIndexOf.get(node.id),
    reachedByScript: reached,
    // Rotation and scale need a rotation matrix: a sprite that starts turned or scaled, or one whose transform a script writes.
    rotatable: (node) => !isUpright(getSpriteTransform(node)) || scripts.dynamicRootIds.has(node.id)
  });
  const audio = collectAudio(project, diagnostics, scripts.playedIds, nodeIndexOf);
  const colliders = collectCollision2D(project, diagnostics, scripts.overlapIds, nodeIndexOf);
  const tileMaps = collectTileMaps(project, diagnostics, nodeIndexOf);
  const inventories = collectInventory2D(project, nodeIndexOf, inventoryPanels);
  const spawnPoolsOut = collectSpawnPools(spawnPools.pools, nodeIndexOf);

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
      items: compileInventoryItems(project),
      inventories,
      spawnPools: spawnPoolsOut,
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

/** A `DsInventory`'s own panel fields when a node has no panel configured (STORY.inventory-ui-panel.md): every index -1, every size/spacing 0. Shared by both translators (translateScene3D's own 2D screen included). */
export const NO_INVENTORY_PANEL: InventoryPanelFields = {
  panelX: 0,
  panelY: 0,
  columns: 0,
  slotWidth: 0,
  slotHeight: 0,
  spacingX: 0,
  spacingY: 0,
  backgroundSprite: -1,
  slotSpriteStart: -1,
  iconSpriteStart: -1,
  highlightSprite: -1,
  labelStart: -1,
  screen: "top"
};

/**
 * Inventory nodes a script can reach (STORY.inventory.md), the same "nothing reaches it, nothing is built" rule
 * `collectCollision2D` uses -- an Inventory nothing names/attaches a script to is pointless (only a script can ever
 * add/remove/query it), so it is never in the ROM at all. Which items it can hold is project-wide
 * (`compileInventoryItems`), not per-node; only the slot count and its own panel (STORY.inventory-ui-panel.md, from
 * `collectSprites`'s own `inventoryPanels` -- the exact same gate already kept a node out of `nodeIndexOf` kept its
 * panel out of that map too) are per-node.
 */
function collectInventory2D(project: ProjectSnapshot, nodeIndexOf: ReadonlyMap<string, number>, inventoryPanels: ReadonlyMap<string, InventoryPanelFields>): DsInventory[] {
  const inventories: DsInventory[] = [];
  for (const node of flattenSceneTreeInOrder(project.scene)) {
    if (node.kind !== "Inventory") continue;
    const index = nodeIndexOf.get(node.id);
    if (index === undefined) continue;
    inventories.push({ node: index, slots: getInventory(node).slots, ...(inventoryPanels.get(node.id) ?? NO_INVENTORY_PANEL) });
  }
  return inventories;
}

/**
 * The compiled `DsSpawnPool` of every spawn pool `expandSpawnPools` found (STORY.spawn-pools.md), shared by
 * `translateScene2D` and `translateScene3D` (its own 2D screen gets no `screen` field reader at all -- see
 * `DsSpawnPool`'s own comment). `nodeStart`/`nodesPerCopy` come straight from where the node table ended up
 * putting a pool's own first two copies' own roots: copies are tree siblings of each other, structurally
 * identical, so they occupy one contiguous, evenly-spaced run (confirmed by a dedicated test, since the whole
 * runtime design assumes it) -- a pool's own `copyRootIds` always has at least 2 entries (`isSpawnPool` requires
 * `spawnPoolCount > 1`), so there's always a second root to measure the spacing from. A pool whose own copies
 * never made it into the node table (refused by `nestedSpawnPools`, so never expanded at all) is left out.
 */
export function collectSpawnPools(pools: SpawnPoolExpansion["pools"], nodeIndexOf: ReadonlyMap<string, number>): DsSpawnPool[] {
  const result: DsSpawnPool[] = [];
  for (const pool of pools) {
    const nodeStart = nodeIndexOf.get(pool.copyRootIds[0]);
    const secondRoot = nodeIndexOf.get(pool.copyRootIds[1]);
    if (nodeStart === undefined || secondRoot === undefined) continue;
    result.push({ nodeStart, nodesPerCopy: secondRoot - nodeStart, count: pool.copyRootIds.length, screen: pool.screen });
  }
  return result;
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
