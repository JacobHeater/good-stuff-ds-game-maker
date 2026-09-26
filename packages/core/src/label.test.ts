import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL, getLabel, labelCell, labelCellOnScreen, labelDisplayText, MAX_LABEL_CHARS } from "./label";

/** requirements/scene-designer/STORY.labels-and-text.md: the label's data. */

describe("a label's data", () => {
  it("has defaults, keeps the color to the eight there are, and cuts the text to what a label can hold", () => {
    expect(getLabel({})).toEqual(DEFAULT_LABEL);
    expect(getLabel({ label: { color: 12 } }).color).toBe(7);
    expect(getLabel({ label: { color: -3 } }).color).toBe(0);
    expect(getLabel({ label: { color: 2.5 } }).color).toBe(7);
    expect(getLabel({ label: { text: "x".repeat(200) } }).text).toHaveLength(MAX_LABEL_CHARS);
  });

  it("sits on the 8 x 8 grid: the nearest cell to the position", () => {
    expect(labelCell({ x: 0, y: 0 })).toEqual({ column: 0, row: 0 });
    expect(labelCell({ x: 11, y: 13 })).toEqual({ column: 1, row: 2 });
    expect(labelCell({ x: 252, y: 188 })).toEqual({ column: 32, row: 24 });
    expect(labelCellOnScreen({ column: 31, row: 23 })).toBe(true);
    expect(labelCellOnScreen({ column: 32, row: 0 })).toBe(false);
    expect(labelCellOnScreen({ column: -1, row: 0 })).toBe(false);
  });

  it("shows the value where the text has {}", () => {
    expect(labelDisplayText("Score: {}", 42)).toBe("Score: 42");
    expect(labelDisplayText("{} / {}", -3)).toBe("-3 / -3");
    expect(labelDisplayText("plain", 5)).toBe("plain");
  });
});
