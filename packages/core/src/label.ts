import type { SceneNode } from "./scene-node";

/**
 * A `Label` (requirements/scene-designer/STORY.labels-and-text.md): text on a 2D screen, drawn by the DS's built-in 8 x 8 font on the screen's text layer. So a label sits on the **8 x 8 pixel
 * grid** (its position is where its top-left corner goes, rounded to the nearest cell: 32 columns and 24 rows a screen), draws in one of **eight colors**, and can't be turned or scaled.
 * Where the text has `{}` the label's `value` (a whole number a script sets: `$Score.value = 5`) is written; a script can also swap the whole text (`$Label.text = "Game Over"`).
 */
export interface LabelData {
  text: string;
  /** 0 black, 1 red, 2 green, 3 yellow, 4 blue, 5 magenta, 6 cyan, 7 white (the terminal colors the DS console uses). */
  color: number;
}

export const LABEL_COLORS: readonly { name: string; css: string }[] = [
  { name: "Black", css: "#000000" },
  { name: "Red", css: "#e03030" },
  { name: "Green", css: "#30c030" },
  { name: "Yellow", css: "#e0d030" },
  { name: "Blue", css: "#4060e8" },
  { name: "Magenta", css: "#d040d0" },
  { name: "Cyan", css: "#30d0d0" },
  { name: "White", css: "#f0f0f0" }
];

/** The most characters a label's text can have (a screen holds 32 x 24 = 768; this keeps one label from taking a whole screen's memory). */
export const MAX_LABEL_CHARS = 96;
/** The most labels one screen's text layer keeps track of. */
export const MAX_LABELS_PER_SCREEN = 32;
export const LABEL_COLUMNS = 32;
export const LABEL_ROWS = 24;
export const DEFAULT_LABEL: Readonly<LabelData> = { text: "Label", color: 7 };

/** A node's text and color with the defaults filled in and the color kept to the eight there are. */
export function getLabel(node: { label?: Partial<LabelData> }): LabelData {
  const data = node.label ?? {};
  const color = data.color !== undefined && Number.isInteger(data.color) ? Math.min(7, Math.max(0, data.color)) : DEFAULT_LABEL.color;
  return { text: (data.text ?? DEFAULT_LABEL.text).slice(0, MAX_LABEL_CHARS), color };
}

/** The grid cell a position (pixels) falls in: the label's first character is drawn there. */
export function labelCell(position: { x: number; y: number }): { column: number; row: number } {
  return { column: Math.round(position.x / 8), row: Math.round(position.y / 8) };
}

/** Whether the cell is on the screen (a label whose first character is off it is never seen). */
export function labelCellOnScreen(cell: { column: number; row: number }): boolean {
  return cell.column >= 0 && cell.column < LABEL_COLUMNS && cell.row >= 0 && cell.row < LABEL_ROWS;
}

/** The text a label shows with its value in place of each `{}` (the runtime does the same). */
export function labelDisplayText(text: string, value: number): string {
  return text.split("{}").join(String(Math.trunc(value)));
}

export type LabelNode = SceneNode & { kind: "Label" };
