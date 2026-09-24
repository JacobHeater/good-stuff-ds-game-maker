import type { RecentProjectListing } from "@goodstuff/core";
import { useEffect, useState } from "react";

import { useEditorStore } from "../editor/state/editor-store";

function formatLastOpened(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Open Existing Project: the recent projects, most recent first, plus Browse
 * for one that isn't listed. Opening any of them applies the mode stored in
 * that project — this flow never asks for, or offers to change, a mode
 * (see requirements/project-list/STORY.recent-projects-list-on-startup-view.md).
 */
export function OpenProjectPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const { openProject } = useEditorStore();
  const [projects, setProjects] = useState<RecentProjectListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.goodstuff.recents
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (filePath?: string): Promise<void> => {
    setError(null);
    setBusy(true);
    const result = await openProject(filePath);
    setBusy(false);
    if (result.outcome === "error") setError(result.message ?? "Could not open the project.");
  };

  const remove = async (path: string): Promise<void> => setProjects(await window.goodstuff.recents.remove(path));
  const clear = async (): Promise<void> => setProjects(await window.goodstuff.recents.clear());

  return (
    <div className="flex w-[34rem] flex-col gap-4">
      <h2 className="text-lg font-semibold">Open Existing Project</h2>

      {projects === null ? (
        <p className="text-xs text-editor-text-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="rounded border border-dashed border-editor-border p-4 text-center text-xs text-editor-text-muted">
          No recent projects yet. Browse for a project file to open.
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto" aria-label="Recent projects">
          {projects.map((project) => (
            <li key={project.path} className="flex items-stretch gap-1.5">
              <button
                type="button"
                disabled={busy || project.missing}
                onClick={() => void open(project.path)}
                title={project.path}
                className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded border border-editor-border px-3 py-2 text-left ${
                  project.missing
                    ? "cursor-not-allowed bg-editor-panel opacity-50"
                    : "bg-editor-panel-alt hover:border-editor-accent"
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate text-sm font-semibold">{project.name}</span>
                  <span className="rounded bg-editor-accent/20 px-1.5 text-[10px] font-semibold text-editor-accent">
                    {project.mode}
                  </span>
                  {project.missing && (
                    <span className="rounded bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-300">missing</span>
                  )}
                </span>
                <span className="w-full truncate text-[11px] text-editor-text-muted">{project.path}</span>
                <span className="text-[10px] text-editor-text-muted">
                  Last opened {formatLastOpened(project.lastOpenedAt)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${project.name} from the list`}
                title="Remove from list (the file is not deleted)"
                onClick={() => void remove(project.path)}
                className="rounded border border-editor-border px-2 text-xs text-editor-text-muted hover:border-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="rounded px-3 py-1.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          {projects && projects.length > 0 && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              className="rounded px-3 py-1.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
            >
              Clear list
            </button>
          )}
          <button
            type="button"
            onClick={() => void open()}
            disabled={busy}
            className="rounded bg-editor-accent px-4 py-1.5 text-xs font-semibold text-editor-bg hover:opacity-90 disabled:opacity-50"
          >
            Browse…
          </button>
        </div>
      </div>
    </div>
  );
}
