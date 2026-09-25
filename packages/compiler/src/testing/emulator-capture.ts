import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import { DS_HEIGHT, DS_WIDTH, type Silhouette } from "./reference-render";

/**
 * Test support: run a ROM in melonDS and read back what the top screen drew, using
 * tools/ds-toolchain/capture-melonds.ps1 (which needs a Windows desktop session and melonDS installed).
 *
 * The runtime clears the 3D screen to a bluish backdrop (`CLEAR_*` in runtime/source/main.c), which is how
 * the screen is found in a picture of the whole emulator window: the bounding box of the bluish pixels.
 * Meshes are grey, so anything inside that box that isn't bluish is a mesh.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE_SCRIPT = resolve(HERE, "..", "..", "..", "..", "tools", "ds-toolchain", "capture-melonds.ps1");
const INPUT_SCRIPT = resolve(HERE, "..", "..", "..", "..", "tools", "ds-toolchain", "melonds-input.ps1");

/**
 * The backdrop color as melonDS shows it, measured from a capture: the runtime clears to RGB15 (3, 5, 10) and
 * the emulator renders that as about (28, 44, 85). Matching the actual color (within a tolerance) rather than
 * "anything bluish" matters at the screen's edge, where pixels blended with the window frame are bluish but not
 * backdrop, and one such column would make the screen look a pixel wider than it is. Grey meshes never match.
 */
const BACKDROP = { r: 28, g: 44, b: 85 };
const isBackdrop = (r: number, g: number, b: number): boolean =>
  Math.abs(r - BACKDROP.r) <= 14 && Math.abs(g - BACKDROP.g) <= 14 && Math.abs(b - BACKDROP.b) <= 16;

export interface EmulatorCapture {
  /** The window title melonDS reports, e.g. "[60/60] melonDS 1.1". */
  title: string;
  pngPath: string;
  /** The top screen resampled to the DS's 256x192, as covered / not covered. */
  silhouette: Silhouette;
  /** Where the top screen was found in the picture, in picture pixels. */
  screen: { left: number; top: number; width: number; height: number };
}

export function captureRom(romPath: string, pngPath: string, waitSeconds = 5): EmulatorCapture {
  const run = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Rom", romPath, "-Out", pngPath, "-WaitSeconds", String(waitSeconds)],
    { encoding: "utf-8", timeout: 60_000 }
  );
  if (run.status !== 0) throw new Error(`Capturing the emulator failed:\n${run.stdout}\n${run.stderr}`);
  return analyzeCapture(pngPath, /^title: (.*)$/m.exec(run.stdout)?.[1]?.trim() ?? "");
}

/** What to press while the emulator runs (see tools/ds-toolchain/melonds-input.ps1 for the keys and how it works). */
export interface EmulatorInput {
  /** Buttons pressed once, one after another, before anything else (`a`, `left`, ...). */
  tap?: string[];
  /** Buttons held down while the picture is taken. */
  hold?: string[];
  /** A mouse press, in absolute screen pixels (a touch, when it is on the bottom screen), held while the picture is taken. */
  click?: { x: number; y: number };
  /** How long the held input is kept before the picture, in seconds. */
  holdSeconds?: number;
  /** Seconds to let the game start before sending anything. */
  bootSeconds?: number;
}

export interface InputCapture extends EmulatorCapture {
  /** The emulator window's position and size on the desktop, in screen pixels. */
  window: { left: number; top: number; width: number; height: number };
}

/** Runs a ROM in melonDS, sends it real button presses and/or a touch, and reads back the top screen. */
export function captureRomWithInput(romPath: string, pngPath: string, input: EmulatorInput = {}): InputCapture {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INPUT_SCRIPT, "-Rom", romPath, "-Out", pngPath];
  if (input.bootSeconds !== undefined) args.push("-BootSeconds", String(input.bootSeconds));
  if (input.holdSeconds !== undefined) args.push("-HoldSeconds", String(input.holdSeconds));
  if (input.tap?.length) args.push("-Tap", input.tap.join(","));
  if (input.hold?.length) args.push("-Hold", input.hold.join(","));
  if (input.click) args.push("-Click", `${Math.round(input.click.x)},${Math.round(input.click.y)}`);
  const run = spawnSync("powershell", args, { encoding: "utf-8", timeout: 90_000 });
  if (run.status !== 0) throw new Error(`Sending input to the emulator failed:\n${run.stdout}\n${run.stderr}`);
  const rect = /^window: (-?\d+) (-?\d+) (\d+) (\d+)$/m.exec(run.stdout);
  if (!rect) throw new Error(`The input tool didn't report the window's position:\n${run.stdout}`);
  const capture = analyzeCapture(pngPath, "");
  return { ...capture, window: { left: Number(rect[1]), top: Number(rect[2]), width: Number(rect[3]), height: Number(rect[4]) } };
}

/**
 * Where a point on the bottom screen is on the desktop, given a capture that found the top screen: the bottom screen sits directly below the top
 * one and is the same size. `fx` and `fy` are fractions of the screen (0..1, from its top left).
 */
export function bottomScreenPoint(capture: InputCapture, fx: number, fy: number): { x: number; y: number } {
  const { screen, window } = capture;
  return { x: window.left + screen.left + fx * screen.width, y: window.top + screen.top + screen.height + fy * screen.height };
}

function analyzeCapture(pngPath: string, title: string): EmulatorCapture {
  const png = PNG.sync.read(readFileSync(pngPath));
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };

  // The screen is the largest connected block of backdrop-colored pixels. Pieces of whatever is behind the
  // emulator window (colored code in an editor, say) can bleed in at the window's edge, but they are small and
  // disconnected from it; and meshes, however many, leave the backdrop connected around the screen's margin.
  // (Per-row or per-column density rules were tried first and each failed on one kind of scene or the other.)
  const screen = largestBackdropBlock(png.width, png.height, (x, y) => {
    const [r, g, b] = at(x, y);
    return isBackdrop(r, g, b);
  }, pngPath);

  // What was found must actually look like the DS screen: 256x192, so 4:3, and a sensible size. A capture of
  // something else (another window on top of the emulator) must fail here, not produce a meaningless score.
  const aspect = screen.width / screen.height;
  if (Math.abs(aspect - DS_WIDTH / DS_HEIGHT) > 0.03 || screen.width < DS_WIDTH * 0.75 || screen.width > DS_WIDTH * 6) {
    throw new Error(
      `What was captured in ${pngPath} doesn't look like the DS screen (found ${screen.width}x${screen.height}). ` +
        "Was another window in front of the emulator?"
    );
  }

  // The screen is 256x192 scaled uniformly; sample the middle of each DS pixel's footprint.
  const scale = screen.width / DS_WIDTH;
  const mask = new Uint8Array(DS_WIDTH * DS_HEIGHT);
  for (let y = 0; y < DS_HEIGHT; y++) {
    for (let x = 0; x < DS_WIDTH; x++) {
      const sx = Math.min(png.width - 1, Math.floor(screen.left + (x + 0.5) * scale));
      const sy = Math.min(png.height - 1, Math.floor(screen.top + (y + 0.5) * scale));
      const [r, g, b] = at(sx, sy);
      mask[y * DS_WIDTH + x] = isBackdrop(r, g, b) ? 0 : 1;
    }
  }
  return { title, pngPath, silhouette: { width: DS_WIDTH, height: DS_HEIGHT, mask }, screen };
}

/** How far to erode the screen block to shave off thin, blended pixels along the window's rounded edge. */
const EDGE_TRIM = 3;

/**
 * Bounding box of the largest 4-connected block of pixels for which `isBackdropAt` is true, with thin
 * appendages (a couple of edge pixels that are blended with the window frame) removed: the block is eroded
 * by `EDGE_TRIM` pixels, its box taken, and the box grown back by the same amount. A straight edge comes back
 * exactly; anything narrower than twice the trim disappears.
 */
function largestBackdropBlock(
  width: number,
  height: number,
  isBackdropAt: (x: number, y: number) => boolean,
  pngPath: string
): { left: number; top: number; width: number; height: number } {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let bestStart = -1;
  let bestSize = 0;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !isBackdropAt(start % width, Math.floor(start / width))) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const cell = queue[head++];
      const x = cell % width;
      const y = (cell - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!seen[n] && isBackdropAt(nx, ny)) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestStart = start;
    }
  }
  if (bestStart < 0) throw new Error(`No 3D backdrop found in ${pngPath}: the ROM didn't render, or the window was covered.`);

  // Re-flood the winner into its own mask.
  let mask = new Uint8Array(width * height);
  {
    let head = 0;
    let tail = 0;
    queue[tail++] = bestStart;
    mask[bestStart] = 1;
    while (head < tail) {
      const cell = queue[head++];
      const x = cell % width;
      const y = (cell - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!mask[n] && isBackdropAt(nx, ny)) {
          mask[n] = 1;
          queue[tail++] = n;
        }
      }
    }
  }

  for (let i = 0; i < EDGE_TRIM; i++) {
    const next = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const c = y * width + x;
        if (mask[c] && mask[c - 1] && mask[c + 1] && mask[c - width] && mask[c + width]) next[c] = 1;
      }
    }
    mask = next;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`The backdrop in ${pngPath} is too thin to be the DS screen.`);
  return {
    left: minX - EDGE_TRIM,
    top: minY - EDGE_TRIM,
    width: maxX - minX + 1 + 2 * EDGE_TRIM,
    height: maxY - minY + 1 + 2 * EDGE_TRIM
  };
}
