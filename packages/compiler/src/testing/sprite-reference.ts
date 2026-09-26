import { getSpriteAnimations, getSpriteFramePixels, getSpriteFrames, getSpritePalette, getSpriteTransform, isUpright, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";

/**
 * Test support: what a screen full of sprites should look like on the emulator, painted from the project's own images with a plain painter's algorithm (no DS code), and
 * how closely a capture matches it. Sprites aren't filtered or lit, so this is an exact comparison (within the emulator's color conversion).
 */

export type Rgb15 = [number, number, number];

/** The 2D runtime's backdrops (`TOP_BACKDROP` / `BOTTOM_BACKDROP` in runtime2d/source/main.c). */
export const BACKDROP_2D_PROJECT: Record<"top" | "bottom", Rgb15> = { top: [3, 5, 10], bottom: [10, 5, 3] };
/** The 3D runtime leaves the screen its 2D engine shows black (`setBackdropColorSub` in runtime/source/main.c). */
export const BACKDROP_BLACK: Rgb15 = [0, 0, 0];

/** A 5-bit channel as the emulator shows it: widened to 6 bits by `c * 2 + 1`, then to 8 by repeating the top bits. */
export function shown(c5: number): number {
  const c6 = c5 * 2 + 1;
  return (c6 << 2) | (c6 >> 4);
}

/** What each screen should look like, from the project's own sprite images: 8-bit RGB, 256 x 192 (`backdrop` is each screen's background color). */
/**
 * A sprite shows frame 0 of its picture; an AnimatedSprite2D shows the first frame of the animation it starts with. `frameOf` overrides that for a node (to say where an
 * animation has got to by the time the screen is captured).
 */
export function drawReference(
  project: ProjectSnapshot,
  backdrop: Record<"top" | "bottom", Rgb15>,
  frameOf?: (node: SceneNode) => number | undefined
): Record<"top" | "bottom", Uint8Array> {
  const images = new Map<string, ImportedSprite>((project.sprites ?? []).map((sprite) => [sprite.id, sprite]));
  const result = {} as Record<"top" | "bottom", Uint8Array>;
  for (const screen of ["top", "bottom"] as const) {
    const out = new Uint8Array(256 * 192 * 3);
    for (let i = 0; i < 256 * 192; i++) out.set(backdrop[screen].map(shown), i * 3);
    const visit = (node: ProjectSnapshot["scene"]): void => {
      const drawn = (node.kind === "Sprite2D" || node.kind === "AnimatedSprite2D") && node.visible && node.screen === screen && node.spriteId;
      const sheet = drawn ? images.get(node.spriteId as string) : undefined;
      if (sheet) {
        const palette = getSpritePalette(sheet);
        const start = node.kind === "AnimatedSprite2D" ? getSpriteAnimations(node) : null;
        const startAnimation = start?.animations.find((animation) => animation.name === start.start);
        const frame = frameOf?.(node) ?? startAnimation?.frames[0] ?? 0;
        const pixels = getSpriteFramePixels(sheet, frame);
        const { frameWidth, frameHeight } = getSpriteFrames(sheet);
        // What is drawn is one frame: the code below sees it as the whole picture.
        const image = { width: frameWidth, height: frameHeight };
        const transform = getSpriteTransform(node);
        if (!isUpright(transform)) {
          // Rotated or scaled: for each screen pixel in the picture's reach, find the picture pixel it shows (the inverse of turning clockwise by the angle and scaling
          // about the center), as the hardware's rotation matrix does, with nearest-neighbor sampling.
          const angle = (transform.rotation * Math.PI) / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const reach = Math.ceil(Math.hypot(image.width * Math.abs(transform.scale.x), image.height * Math.abs(transform.scale.y)) / 2) + 1;
          for (let sy = Math.floor(node.position.y) - reach; sy <= Math.floor(node.position.y) + reach; sy++) {
            for (let sx = Math.floor(node.position.x) - reach; sx <= Math.floor(node.position.x) + reach; sx++) {
              if (sx < 0 || sy < 0 || sx >= 256 || sy >= 192) continue;
              const dx = sx + 0.5 - node.position.x;
              const dy = sy + 0.5 - node.position.y;
              const tx = (cos * dx + sin * dy) / transform.scale.x + image.width / 2;
              const ty = (-sin * dx + cos * dy) / transform.scale.y + image.height / 2;
              const ix = Math.floor(tx);
              const iy = Math.floor(ty);
              if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
              const index = pixels[iy * image.width + ix];
              if (index === 0) continue;
              const color = palette[index];
              out.set([shown(color & 31), shown((color >> 5) & 31), shown((color >> 10) & 31)], (sy * 256 + sx) * 3);
            }
          }
          node.children.forEach(visit);
          return;
        }
        const left = Math.round(node.position.x - image.width / 2);
        const top = Math.round(node.position.y - image.height / 2);
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            const index = pixels[y * image.width + x];
            const sx = left + x;
            const sy = top + y;
            if (index === 0 || sx < 0 || sy < 0 || sx >= 256 || sy >= 192) continue;
            const color = palette[index];
            out.set([shown(color & 31), shown((color >> 5) & 31), shown((color >> 10) & 31)], (sy * 256 + sx) * 3);
          }
        }
      }
      node.children.forEach(visit);
    };
    visit(project.scene);
    result[screen] = out;
  }
  return result;
}

/** The fraction of pixels whose color is within `tolerance` of the reference on every channel. */
export function matchRatio(actual: Uint8Array, expected: Uint8Array, tolerance = 8): number {
  let same = 0;
  for (let i = 0; i < 256 * 192; i++) {
    if ([0, 1, 2].every((c) => Math.abs(actual[i * 3 + c] - expected[i * 3 + c]) <= tolerance)) same++;
  }
  return same / (256 * 192);
}

/** How many pixels of a screen aren't its backdrop. */
export function covered(screen: Uint8Array, backdrop: Rgb15): number {
  const [r, g, b] = backdrop.map(shown);
  let count = 0;
  for (let i = 0; i < 256 * 192; i++) {
    if (Math.abs(screen[i * 3] - r) > 8 || Math.abs(screen[i * 3 + 1] - g) > 8 || Math.abs(screen[i * 3 + 2] - b) > 8) count++;
  }
  return count;
}
