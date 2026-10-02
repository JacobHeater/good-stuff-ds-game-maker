/**
 * Canonical hardware capabilities and limits of the original Nintendo DS.
 * These values exist so the editor can surface real budget constraints to the
 * designer (VRAM usage, sprite counts, polygon budget, etc.) the same way
 * Godot surfaces target-platform limits, except here the "platform" is fixed.
 *
 * Sources: Nintendo DS technical specifications (ARM946E-S/ARM7TDMI, 4MB RAM,
 * 656KB VRAM, 256x192 dual TFT screens, ~2048 triangle/frame 3D budget,
 * 512KB texture memory, 1024x1024 max texture size, 128 OAM sprites/screen,
 * 16 audio channels).
 */
export const DS_HARDWARE_PROFILE = {
  cpu: {
    main: { name: "ARM946E-S", clockMHz: 67 },
    coprocessor: { name: "ARM7TDMI", clockMHz: 33 }
  },
  memory: {
    mainRamBytes: 4 * 1024 * 1024,
    videoRamBytes: 656 * 1024,
    textureMemoryBytes: 512 * 1024
  },
  screens: {
    count: 2,
    width: 256,
    height: 192,
    aspectRatio: "4:3"
  },
  graphics2D: {
    /** Each screen has its own independent 2D engine and OAM (sprite) table. */
    oamSpritesPerScreen: 128,
    maxSpriteSizePx: 64,
    /** Sprite tile memory each 2D engine can address (one 128 KB VRAM bank each); a 256-color image takes a byte a pixel. */
    spriteMemoryBytesPerScreen: 128 * 1024,
    /** Extended palettes: each engine holds 16 palettes of 256 colors for its 8-bit sprites. */
    spritePalettesPerScreen: 16
  },
  graphics3D: {
    /** Only one screen at a time can receive 3D output. */
    exclusiveToSingleScreen: true,
    approxTrianglesPerFrame: 2048,
    maxTextureSizePx: 1024
  },
  audio: {
    channels: 16,
    /**
     * Main RAM a game may spend on the samples of the sounds it plays: half of the DS's 4 MB, leaving the rest for the program,
     * the 3D data and the textures' source data (the samples sit in RAM, where the sound hardware reads them from).
     */
    soundMemoryBytes: 2 * 1024 * 1024
  },
  frameRate: {
    /** The DS LCD refreshes at ~59.8Hz; games target 60fps or a 30fps half-step. */
    supportedFpsTargets: [30, 60] as const,
    defaultFpsTarget: 60
  }
} as const;

export type FpsTarget = (typeof DS_HARDWARE_PROFILE.frameRate.supportedFpsTargets)[number];

/**
 * The triangle budget at a frame rate: `approxTrianglesPerFrame` is what the DS can draw in one 60fps frame's worth of
 * time, so targeting 30fps gives the GPU twice as long per frame and so doubles how many triangles fit in it.
 */
export function triangleBudgetFor(fpsTarget: FpsTarget): number {
  return Math.round(DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame * (DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget / fpsTarget));
}
