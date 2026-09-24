import type { FpsTarget } from "@goodstuff/core";
import { DS_HARDWARE_PROFILE } from "@goodstuff/core";

import { useEditorStore, workspacesForMode, type ScreenFilter } from "../state/editor-store";

const SCREEN_FILTERS: { id: ScreenFilter; label: string }[] = [
  { id: "both", label: "Both Screens" },
  { id: "top", label: "Top Screen" },
  { id: "bottom", label: "Bottom Screen" }
];
/** The DS's 3D engine can only drive one screen at a time, so "Both" isn't a valid choice in a 3D project. */
const SCREEN_FILTERS_3D = SCREEN_FILTERS.filter((option) => option.id !== "both");

function tabClasses(active: boolean): string {
  return active
    ? "rounded bg-editor-accent px-3 py-1 text-xs font-medium text-editor-bg"
    : "rounded px-3 py-1 text-xs font-medium text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text";
}

/**
 * The bar directly under the menu: workspace switcher, the screen filter,
 * the FPS target, and playtest controls. The switcher only offers the open
 * project's own viewport tab (2D *or* 3D, never both — a project's mode is
 * permanent) plus the mode-independent Script/Game tabs.
 */
export function WorkspaceToolbar(): JSX.Element {
  const { state, setWorkspace, setScreenFilter, setFpsTarget, play, playing } = useEditorStore();
  const mode = state.project?.mode;
  const workspaces = mode ? workspacesForMode(mode) : [];

  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-editor-border bg-editor-panel px-3">
      <div className="flex items-center gap-1">
        {workspaces.map((workspace) => (
          <button
            key={workspace}
            type="button"
            className={tabClasses(state.activeWorkspace === workspace)}
            onClick={() => setWorkspace(workspace)}
          >
            {workspace}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <select
          value={state.screenFilter}
          onChange={(event) => setScreenFilter(event.target.value as ScreenFilter)}
          className="rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text"
        >
          {(mode === "3D" ? SCREEN_FILTERS_3D : SCREEN_FILTERS).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-xs text-editor-text-muted">
          <span>FPS</span>
          {DS_HARDWARE_PROFILE.frameRate.supportedFpsTargets.map((fps) => (
            <button
              key={fps}
              type="button"
              onClick={() => setFpsTarget(fps as FpsTarget)}
              className={tabClasses(state.fpsTarget === fps)}
            >
              {fps}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={playing}
          onClick={() => void play()}
          className="rounded bg-editor-accent px-3 py-1 text-xs font-semibold text-editor-bg hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {playing ? "Building..." : "▶ Play"}
        </button>
      </div>
    </div>
  );
}
