import type { WorkspaceId } from "./editor-store";

/**
 * The editor's keyboard shortcuts, decided as pure data (`resolveShortcut`) so every rule is unit-tested without a DOM: which key does what,
 * and when it is left alone. The store's provider listens for `keydown` on the window, asks this module what the key means, and runs the
 * command. (Q / W / E / R for the transform tools are handled in `WorkspaceToolbar.tsx`, since they belong to the 3D toolbar.)
 *
 *   Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y   undo / redo / redo
 *   Ctrl+S / Ctrl+Shift+S            save / save as
 *   Ctrl+O                           open a project
 *   Ctrl+Shift+E                     export ROM
 *   F5                               play
 *   Ctrl+D                           duplicate the selected node
 *   Delete / Backspace               delete the selected node
 *   F2                               rename the selected node (focuses the Inspector's Name field)
 *   Escape                           select the scene root (deselect)
 *   Arrow keys / Shift+Arrow keys    nudge the selected 2D node by 1 / 8 pixels
 *   Ctrl+1 / Ctrl+2 / Ctrl+3         the viewport / Script / Game workspace
 *
 * Cmd counts as Ctrl. Every shortcut is ignored while the unsaved-changes prompt is up and when no project is open.
 */

export type ShortcutCommand =
  | { type: "undo" | "redo" | "save" | "save-as" | "open" | "export-rom" | "play" | "duplicate" | "delete" | "rename" | "select-root" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "workspace"; workspace: WorkspaceId };

/** Where keyboard focus is: in a text field (or select), in the script's code editor, or on nothing that keeps keys for itself. */
export type FocusKind = "none" | "field" | "code";

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface ShortcutContext {
  projectOpen: boolean;
  /** The unsaved-changes prompt is showing. */
  promptOpen: boolean;
  /** The workspace tab in view. Selection shortcuts only work on the scene's own viewport (2D or 3D). */
  workspace: WorkspaceId;
  /** The open project's workspace tabs in order (the viewport, Script, Game), for Ctrl+1..3. */
  workspaces: readonly WorkspaceId[];
  selectedIsRoot: boolean;
  /** The selected node has a 2D position the arrow keys can change (a node with a place on the 2D screen). */
  selectedHasPosition2D: boolean;
  focus: FocusKind;
}

/** Where focus is for a key event's target: the code editor keeps its own undo and typing keys, other fields keep typing keys. */
export function classifyFocus(target: EventTarget | null): FocusKind {
  if (typeof Element === "undefined" || !(target instanceof Element)) return "none";
  if (target.closest(".cm-editor")) return "code";
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return "field";
  return "none";
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const NUDGE_PIXELS = 1;
const NUDGE_PIXELS_FAST = 8;

/** What a key press means, or null when it means nothing here (and so must be left alone, not prevented). */
export function resolveShortcut(event: ShortcutKey, context: ShortcutContext): ShortcutCommand | null {
  if (!context.projectOpen || context.promptOpen) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const onScene = context.workspace === "2D" || context.workspace === "3D";
  const notTyping = context.focus === "none";

  if (mod && !event.altKey) {
    switch (key) {
      case "z":
        // Inside the code editor Ctrl+Z is that editor's own text undo (it has its own history).
        return context.focus === "code" ? null : { type: event.shiftKey ? "redo" : "undo" };
      case "y":
        return context.focus === "code" || event.shiftKey ? null : { type: "redo" };
      case "s":
        return { type: event.shiftKey ? "save-as" : "save" };
      case "o":
        return event.shiftKey ? null : { type: "open" };
      case "e":
        return event.shiftKey ? { type: "export-rom" } : null;
      case "d":
        return !event.shiftKey && onScene && notTyping && !context.selectedIsRoot ? { type: "duplicate" } : null;
      case "1":
      case "2":
      case "3": {
        const workspace = context.workspaces[Number(key) - 1];
        return workspace && !event.shiftKey ? { type: "workspace", workspace } : null;
      }
      default:
        return null;
    }
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  switch (key) {
    case "F5":
      return event.shiftKey || event.repeat ? null : { type: "play" };
    case "F2":
      return onScene && !event.shiftKey ? { type: "rename" } : null;
    case "Delete":
    case "Backspace":
      return onScene && notTyping && !event.shiftKey && !event.repeat && !context.selectedIsRoot ? { type: "delete" } : null;
    case "Escape":
      return onScene && notTyping && !context.selectedIsRoot ? { type: "select-root" } : null;
    default: {
      const arrow = ARROWS[key];
      if (!arrow || !onScene || !notTyping || !context.selectedHasPosition2D) return null;
      const step = event.shiftKey ? NUDGE_PIXELS_FAST : NUDGE_PIXELS;
      return { type: "nudge", dx: arrow[0] * step, dy: arrow[1] * step };
    }
  }
}
