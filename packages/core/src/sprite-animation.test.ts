import { describe, expect, it } from "vitest";

import { createSpriteFromRgba, getSpriteFramePixels, getSpriteFrames, spriteToRgba } from "./imported-sprite";
import { clampSpriteAnimationFps, formatFrameList, getSpriteAnimations, nextAnimationName, parseFrameList } from "./sprite-animation";

/** requirements/scene-designer/STORY.animated-sprites.md */

/** A sheet of `count` frames in a grid `columns` wide, `size` pixels square: frame k is filled with a color of its own (red = 40 * (k + 1)). */
function sheetRgba(count: number, size: number, columns = count): { rgba: Uint8Array; width: number; height: number } {
  const rows = Math.ceil(count / columns);
  const width = columns * size;
  const height = rows * size;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frame = Math.floor(y / size) * columns + Math.floor(x / size);
      const i = (y * width + x) * 4;
      rgba[i] = 40 * (frame + 1);
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height };
}

describe("importing a sprite sheet", () => {
  it("keeps the sheet whole, records the frame size and counts the frames", () => {
    const { rgba, width, height } = sheetRgba(4, 16);
    const result = createSpriteFromRgba(rgba, width, height, { name: "run", frame: { width: 16, height: 16 } });
    if (!result.ok) throw new Error(result.errors.join(" "));
    expect(result.sprite).toMatchObject({ width: 64, height: 16, frameWidth: 16, frameHeight: 16 });
    expect(getSpriteFrames(result.sprite)).toEqual({ frameWidth: 16, frameHeight: 16, columns: 4, rows: 1, count: 4 });
  });

  it("reads a grid of frames left to right, top to bottom, and crops each one", () => {
    const { rgba, width, height } = sheetRgba(6, 16, 3); // 3 columns, 2 rows
    const result = createSpriteFromRgba(rgba, width, height, { name: "grid", frame: { width: 16, height: 16 } });
    if (!result.ok) throw new Error(result.errors.join(" "));
    const sprite = { id: "s", ...result.sprite };
    expect(getSpriteFrames(sprite)).toMatchObject({ columns: 3, rows: 2, count: 6 });
    // Each frame is one flat color, and they all differ: frame 4 is the middle one of the second row.
    const reds = [0, 1, 2, 3, 4, 5].map((frame) => {
      const pixels = getSpriteFramePixels(sprite, frame);
      expect(pixels).toHaveLength(16 * 16);
      expect(new Set(pixels).size).toBe(1);
      return spriteToRgba(sprite, frame)[0];
    });
    expect(new Set(reds).size).toBe(6);
    expect([...reds]).toEqual([...reds].sort((a, b) => a - b)); // the colors were given in frame order, so frame order is what comes back
  });

  it("is one frame when the frame is the whole picture, and stores no frame size", () => {
    const { rgba, width, height } = sheetRgba(1, 16);
    const result = createSpriteFromRgba(rgba, width, height, { name: "one", frame: { width: 16, height: 16 } });
    if (!result.ok) throw new Error(result.errors.join(" "));
    expect(result.sprite.frameWidth).toBeUndefined();
    expect(getSpriteFrames(result.sprite).count).toBe(1);
  });

  it("refuses a frame size the DS has no sprite for, and a sheet that isn't a whole number of frames", () => {
    const { rgba, width, height } = sheetRgba(4, 16);
    const odd = createSpriteFromRgba(rgba, width, height, { name: "x", frame: { width: 24, height: 16 } });
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.errors.join(" ")).toMatch(/24 x 16 pixels isn't a size the DS has a sprite for/);
    const doubled = createSpriteFromRgba(rgba, width, height, { name: "x", frame: { width: 32, height: 16 } }); // 64 wide is 2 frames of 32: fine
    expect(doubled.ok).toBe(true);
    const ragged = createSpriteFromRgba(new Uint8Array(48 * 16 * 4).fill(255), 48, 16, { name: "x", frame: { width: 32, height: 16 } });
    expect(ragged.ok).toBe(false);
    if (!ragged.ok) expect(ragged.errors.join(" ")).toMatch(/isn't a whole number of 32 x 16 frames/);
  });

  it("still refuses a picture that isn't a sprite size when no frame size is given, and says how to import a sheet", () => {
    const result = createSpriteFromRgba(new Uint8Array(64 * 16 * 4).fill(255), 64, 16, { name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/say how big one frame is/);
  });

  it("shares one palette across the frames", () => {
    const { rgba, width, height } = sheetRgba(4, 16);
    const result = createSpriteFromRgba(rgba, width, height, { name: "p", frame: { width: 16, height: 16 } });
    if (!result.ok) throw new Error(result.errors.join(" "));
    // Four flat colors + transparent: five palette entries for the whole sheet.
    expect(Buffer.from(result.sprite.palette, "base64").length / 2).toBe(5);
  });
});

describe("frame lists", () => {
  it("reads numbers, ranges (up or down) and a mix", () => {
    expect(parseFrameList("0, 1, 2", 8)).toEqual({ ok: true, frames: [0, 1, 2] });
    expect(parseFrameList("0-3", 8)).toEqual({ ok: true, frames: [0, 1, 2, 3] });
    expect(parseFrameList(" 0-2 ,5, 2-0", 8)).toEqual({ ok: true, frames: [0, 1, 2, 5, 2, 1, 0] });
    expect(parseFrameList("3,3,3", 8)).toEqual({ ok: true, frames: [3, 3, 3] });
  });

  it("says what is wrong: nothing typed, junk, or a frame the sheet doesn't have", () => {
    expect(parseFrameList("  ", 8)).toMatchObject({ ok: false });
    expect(parseFrameList("0, a", 8)).toMatchObject({ ok: false, error: expect.stringContaining('"a"') });
    expect(parseFrameList("0-9", 8)).toMatchObject({ ok: false, error: expect.stringContaining("Frame 9 isn't in the sheet, which has 8 frames") });
    expect(parseFrameList("1", 1)).toMatchObject({ ok: false, error: expect.stringContaining("1 frame ") });
  });

  it("writes runs of three or more as ranges and reads back what it wrote", () => {
    expect(formatFrameList([0, 1, 2, 3])).toBe("0-3");
    expect(formatFrameList([0, 1, 5, 6, 7])).toBe("0, 1, 5-7");
    expect(formatFrameList([4, 3, 2])).toBe("4, 3, 2");
    for (const frames of [[0, 1, 2, 3], [0, 1, 5, 6, 7], [2, 2, 3, 4, 5, 1], [0]]) {
      expect(parseFrameList(formatFrameList(frames), 8)).toEqual({ ok: true, frames });
    }
  });
});

describe("a node's animations", () => {
  it("fills in defaults, limits the speed and drops a start that names nothing", () => {
    const data = getSpriteAnimations({
      spriteAnimations: { animations: [{ name: "run", frames: [0, 1], fps: 500, loop: true }, { name: "idle", frames: [2], fps: 0, loop: false }], start: "gone" }
    });
    expect(data.animations.map((a) => [a.name, a.fps, a.loop])).toEqual([["run", 60, true], ["idle", 1, false]]);
    expect(data.start).toBeUndefined();
    expect(getSpriteAnimations({ spriteAnimations: { animations: [{ name: "run", frames: [0], fps: 8, loop: true }], start: "run" } }).start).toBe("run");
    expect(getSpriteAnimations({})).toEqual({ animations: [] });
  });

  it("names a new animation so it doesn't clash", () => {
    expect(nextAnimationName([])).toBe("anim");
    expect(nextAnimationName([{ name: "anim" }])).toBe("anim2");
    expect(nextAnimationName([{ name: "anim" }, { name: "anim2" }])).toBe("anim3");
    expect(clampSpriteAnimationFps(Number.NaN)).toBe(8);
  });
});
