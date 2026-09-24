import { PROJECT_MODES, type ProjectMode } from "@goodstuff/core";
import { useState, type FormEvent } from "react";

import { useEditorStore } from "../editor/state/editor-store";

const MODE_DESCRIPTIONS: Record<ProjectMode, string> = {
  "2D": "Sprites, tilemaps and labels on the DS's two screens. Uses the DS's 2D engine.",
  "3D": "Polygon meshes, lights and cameras. The DS's 3D engine drives one screen at a time."
};

/**
 * New Project flow. A project must declare itself 2D or 3D before it exists —
 * there is deliberately no default — and that choice can never be changed
 * afterwards (see requirements/startup-view/STORY.new-project-flow-with-mode-commitment.md).
 */
export function NewProjectPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const { createProject } = useEditorStore();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ProjectMode | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedName = name.trim();
    const nextNameError = trimmedName ? null : "Give the project a name.";
    const nextModeError = mode ? null : "Choose 2D or 3D. This can't be changed later.";
    setNameError(nextNameError);
    setModeError(nextModeError);
    setSubmitError(null);
    if (!trimmedName || !mode) return;

    setBusy(true);
    const result = await createProject(trimmedName, mode);
    setBusy(false);
    if (result.outcome === "error") {
      setSubmitError(result.message ?? "Could not create the project.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-[28rem] flex-col gap-5" noValidate>
      <h2 className="text-lg font-semibold">New Project</h2>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="text-editor-text-muted">Project name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My DS Game"
          autoFocus
          className="rounded border border-editor-border bg-editor-panel-alt px-3 py-2 text-sm text-editor-text"
        />
        {nameError && <span className="text-red-400">{nameError}</span>}
      </label>

      <div className="flex flex-col gap-1.5 text-xs">
        <span id="project-mode-label" className="text-editor-text-muted">
          Project mode
        </span>
        <div role="radiogroup" aria-labelledby="project-mode-label" className="grid grid-cols-2 gap-3">
          {PROJECT_MODES.map((option) => {
            const selected = mode === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setMode(option);
                  setModeError(null);
                }}
                className={`flex flex-col items-start gap-1 rounded border p-3 text-left ${
                  selected
                    ? "border-editor-accent bg-editor-accent/15"
                    : "border-editor-border bg-editor-panel-alt hover:border-editor-text-muted"
                }`}
              >
                <span className="text-base font-semibold">{option}</span>
                <span className="text-[11px] leading-snug text-editor-text-muted">{MODE_DESCRIPTIONS[option]}</span>
              </button>
            );
          })}
        </div>
        {modeError ? (
          <span className="text-red-400">{modeError}</span>
        ) : (
          <span className="text-editor-text-muted">
            Permanent: a project can't be converted between 2D and 3D. To switch, start a new project.
          </span>
        )}
      </div>

      {submitError && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{submitError}</div>}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="rounded px-3 py-1.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-editor-accent px-4 py-1.5 text-xs font-semibold text-editor-bg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create Project…"}
        </button>
      </div>
    </form>
  );
}
