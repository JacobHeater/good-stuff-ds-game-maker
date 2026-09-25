import type { ImportedMesh, ImportedSound, ImportedTexture, ProjectScript, SceneNode } from "@goodstuff/core";

/**
 * Undo/redo bookkeeping for scene edits (requirements/scene-designer/TASK.undo-redo-for-scene-edits.md).
 *
 * A history step is a *reference* to the immutable scene tree as it was, plus the project's imported models
 * and the selection: never a copy. That is what lets "undo back to the saved state" read as clean, since the
 * editor decides "unsaved" by comparing the current tree with the saved one by reference.
 *
 * Pure functions on plain data, so every rule here is unit-tested without React.
 */

/** The parts of the editor a scene edit can change, and so what an undo puts back. */
export interface EditState {
  sceneRoot: SceneNode;
  /** The project's imported models (an import adds one, so undoing it has to take it out again). */
  meshes: ImportedMesh[] | undefined;
  /** The project's imported textures (an import adds one, so undoing it has to take it out again). */
  textures: ImportedTexture[] | undefined;
  /** The project's imported sounds (an import adds one, so undoing it has to take it out again). */
  sounds: ImportedSound[] | undefined;
  /** The project's scripts (creating, deleting or editing one is an edit, and so is undoable). */
  scripts: ProjectScript[] | undefined;
  selectedNodeId: string;
}

export interface EditEntry extends EditState {
  /** What the edit was, for the menu and the Output log, e.g. "Delete Camera3D". */
  label: string;
}

export interface EditHistory {
  /** Oldest first. Undo takes the last one. */
  past: EditEntry[];
  /** Undone edits, most recently undone last. Redo takes the last one. */
  future: EditEntry[];
  /** The edit that may still absorb the next one (see `recordEdit`). */
  merge: { key: string; at: number } | null;
}

export const EMPTY_HISTORY: EditHistory = { past: [], future: [], merge: null };

/** Oldest steps are dropped beyond this many. */
export const MAX_HISTORY = 200;
/** Consecutive edits with the same merge key closer together than this are one step. */
export const MERGE_WINDOW_MS = 1000;

/**
 * Notes that an edit is about to be applied to `before`. Edits that share a `mergeKey` (the same property of
 * the same node) and arrive within `MERGE_WINDOW_MS` of the previous one form a single step: dragging a gizmo
 * handle sends an update per frame and typing "1.25" sends one per keystroke, and undoing one frame or one
 * character is never what anyone wants. The window slides, so a continuous gesture stays one step however
 * long it lasts. Any real edit clears the redo stack.
 */
export function recordEdit(
  history: EditHistory,
  before: EditState,
  edit: { label: string; mergeKey?: string; at?: number }
): EditHistory {
  const at = edit.at ?? 0;
  const { merge } = history;
  if (edit.mergeKey && merge && merge.key === edit.mergeKey && at - merge.at < MERGE_WINDOW_MS) {
    return { ...history, merge: { key: edit.mergeKey, at } };
  }
  return {
    past: [...history.past, { ...before, label: edit.label }].slice(-MAX_HISTORY),
    future: [],
    merge: edit.mergeKey ? { key: edit.mergeKey, at } : null
  };
}

/** Ends the current gesture (a released gizmo handle), so the next edit starts a new step however soon it comes. */
export function endGesture(history: EditHistory): EditHistory {
  return history.merge ? { ...history, merge: null } : history;
}

export interface HistoryStep {
  /** What to put back. */
  entry: EditEntry;
  history: EditHistory;
}

/** The step that undoes the last edit, with `current` kept so it can be redone; null when there's nothing to undo. */
export function undoStep(history: EditHistory, current: EditState): HistoryStep | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: { past: history.past.slice(0, -1), future: [...history.future, { ...current, label: entry.label }], merge: null }
  };
}

/** The step that redoes the last undone edit; null when there's nothing to redo. */
export function redoStep(history: EditHistory, current: EditState): HistoryStep | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: { past: [...history.past, { ...current, label: entry.label }], future: history.future.slice(0, -1), merge: null }
  };
}
