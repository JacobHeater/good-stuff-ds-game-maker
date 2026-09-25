import type { FpsTarget } from "@goodstuff/core";
import { DS_HARDWARE_PROFILE } from "@goodstuff/core";
import { useEffect } from "react";

import { screenRolesOf, useEditorStore, workspacesForMode, type EditorTool, type ScreenFilter } from "../state/editor-store";

/** The tools, in toolbar order, with Godot's shortcut keys. */
const TOOLS: { id: EditorTool; label: string; key: string }[] = [
  { id: "select", label: "Select", key: "Q" },
  { id: "move", label: "Move", key: "W" },
  { id: "rotate", label: "Rotate", key: "E" },
  { id: "scale", label: "Scale", key: "R" }
];

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
  const { state, setWorkspace, setScreenFilter, setTwoDScreen, setFpsTarget, setActiveTool, play, playing } = useEditorStore();
  const mode = state.project?.mode;
  const roles = screenRolesOf(state);
  const workspaces = mode ? workspacesForMode(mode) : [];

  // Q / W / E / R pick a tool, unless the user is typing in (or choosing from) a field.
  useEffect(() => {
    if (mode !== "3D") return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const tool = TOOLS.find((candidate) => candidate.key.toLowerCase() === event.key.toLowerCase());
      if (tool) setActiveTool(tool.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, setActiveTool]);

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

      {mode === "3D" && (
        <div role="group" aria-label="Tools" className="flex items-center gap-1">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={`${tool.label} (${tool.key})`}
              aria-pressed={state.activeTool === tool.id}
              className={tabClasses(state.activeTool === tool.id)}
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        {roles && (
          <label className="flex items-center gap-1 text-xs text-editor-text-muted" title="The DS's 3D engine drives one screen; the other is a 2D screen for sprites, labels and a HUD.">
            <span>2D screen</span>
            <select
              aria-label="2D screen"
              value={roles.twoD}
              onChange={(event) => setTwoDScreen(event.target.value as "top" | "bottom")}
              className="rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text"
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        )}
        <select
          aria-label="Screen"
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
