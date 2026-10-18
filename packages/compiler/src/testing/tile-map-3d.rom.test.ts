import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { tileMap3DStreamProject } from "../fixtures";
import { captureRom, captureRomWithInput, type EmulatorCapture } from "./emulator-capture";

/**
 * TileMap3D's own runtime streaming, in a real ROM (requirements/scene-designer's own STORY.tile-map-3d.md, Phase 3; the plan this
 * story was built from is C:\Users\catho\.claude\plans\keen-greeting-glade.md). tileMap3DStreamProject paints one cell at the grid's
 * own origin -- exactly where the camera starts out looking -- and another 45 units further along that same line of sight, both
 * painted with the same one-tile palette. A script moves the camera along +X while Right is held (0.15 units a frame, 60 fps), so
 * holding it for 5 seconds crosses from the near cell's own chunk (0) to the far one's (5; TILE_MAP_3D_CHUNK_SIZE is 8) -- several
 * of the runtime's own 3x3x3 loaded-chunk window's worth of chunk boundaries, not just one.
 *
 * This is the thing Phase 1/2 alone couldn't prove: that the runtime actually reads a chunk file back from the ROM's own NitroFS
 * region *while already running* (not just once at scene start) and draws it in the right place, and that a chunk outside the
 * window is never drawn at all -- the whole reason this feature streams instead of just compiling every cell in like a plain mesh.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
/** The 3D runtime's clear color (main.c: RGB15 3, 5, 10), as melonDS scales 5-bit color up to the 8-bit PNG it captures. */
const BACKDROP = [3, 5, 10].map((v) => Math.round((v * 255) / 31));
const BACKDROP_TOLERANCE = 14;

describe.skipIf(!toolchain.found)("TileMap3D streams its chunks from the ROM in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-tilemap3d-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  /** The fraction of a small box around the middle of the screen that isn't the plain backdrop color -- a painted tile fills much
      more of it than jitter in exactly where its edges land, so this is far more forgiving than a single pixel while still telling
      "something is drawn dead centre" apart from "the screen is empty there". */
  function centerPaintedFraction(capture: EmulatorCapture): number {
    const png = PNG.sync.read(readFileSync(capture.pngPath));
    const { screen } = capture;
    const cx = screen.left + screen.width / 2;
    const cy = screen.top + screen.height / 2;
    const half = 12;
    let painted = 0;
    let total = 0;
    for (let y = Math.round(cy - half); y < cy + half; y++) {
      for (let x = Math.round(cx - half); x < cx + half; x++) {
        const i = (y * png.width + x) * 4;
        const isBackdrop = [0, 1, 2].every((c) => Math.abs(png.data[i + c] - BACKDROP[c]) <= BACKDROP_TOLERANCE);
        if (!isBackdrop) painted++;
        total++;
      }
    }
    return painted / total;
  }

  it(
    "draws the cell at the grid's own origin at the start, before the camera has moved at all",
    async () => {
      const rom = join(work, "stream.nds");
      const built = await compileProject(tileMap3DStreamProject(), rom, builder);
      if (!built.ok) throw new Error(`Build failed: ${built.message}`);
      const idle = captureRom(rom, join(work, "idle.png"), 3);
      const fraction = centerPaintedFraction(idle);
      console.info(`[tile-map-3d] idle: ${(fraction * 100).toFixed(0)}% of the centre box is painted`);
      expect(fraction, "the near cell, exactly where the camera starts out looking, is drawn").toBeGreaterThan(0.3);
    },
    90_000
  );

  it(
    "streams in the far cell's own chunk as the camera moves, and no longer draws the near one",
    async () => {
      const rom = join(work, "stream.nds");
      const built = await compileProject(tileMap3DStreamProject(), rom, builder);
      if (!built.ok) throw new Error(`Build failed: ${built.message}`);

      // Partway there (about 18 units: chunk 2, the near cell's chunk 0 already out of the window, the far cell's chunk 5 not yet
      // in it, and nothing was ever painted at this halfway point either) -- confirms neither a stale leftover nor a premature
      // load, not just "the end state happens to look right".
      const partway = captureRomWithInput(rom, join(work, "partway.png"), { hold: ["right"], holdSeconds: 2 });
      expect(centerPaintedFraction(partway), "nothing painted is anywhere near the middle of this move").toBeLessThan(0.05);

      // The full 45 units (5 s at 0.15/frame, 60 fps): the far cell's own chunk (5) is now in the window and lands exactly back
      // at the centre of the screen, the same place the near cell was before anything moved.
      const held = captureRomWithInput(rom, join(work, "held.png"), { hold: ["right"], holdSeconds: 5 });
      const fraction = centerPaintedFraction(held);
      console.info(`[tile-map-3d] held 5s: ${(fraction * 100).toFixed(0)}% of the centre box is painted`);
      expect(fraction, "the far cell's own chunk streamed in and is drawn in the near cell's old screen position").toBeGreaterThan(0.3);
    },
    120_000
  );
});
