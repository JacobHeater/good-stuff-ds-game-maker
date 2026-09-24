import { useEffect, useRef } from "react";

import { useEditorStore } from "./state/editor-store";

/**
 * The single Save / Don't Save / Cancel prompt shown whenever an action —
 * Close Project, Open Project (or a recent project), closing the window —
 * would discard unsaved edits. Nothing else in the app asks this question;
 * see requirements/project-menu/STORY.unsaved-changes-guard.md.
 */
export function UnsavedChangesDialog(): JSX.Element | null {
  const { state, unsavedPrompt, resolveUnsavedPrompt } = useEditorStore();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!unsavedPrompt) return undefined;
    saveButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") void resolveUnsavedPrompt("cancel");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [unsavedPrompt, resolveUnsavedPrompt]);

  if (!unsavedPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        className="flex w-[26rem] flex-col gap-4 rounded border border-editor-border bg-editor-panel p-5 shadow-xl"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="unsaved-changes-title" className="text-sm font-semibold">
            Save changes to “{state.project?.name}”?
          </h2>
          <p className="text-xs text-editor-text-muted">
            This project has unsaved changes. Save them before you {unsavedPrompt.action}, or they'll be lost.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void resolveUnsavedPrompt("cancel")}
            className="rounded px-3 py-1.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void resolveUnsavedPrompt("discard")}
            className="rounded border border-editor-border bg-editor-panel-alt px-3 py-1.5 text-xs hover:border-editor-text-muted"
          >
            Don't Save
          </button>
          <button
            ref={saveButtonRef}
            type="button"
            onClick={() => void resolveUnsavedPrompt("save")}
            className="rounded bg-editor-accent px-4 py-1.5 text-xs font-semibold text-editor-bg hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
