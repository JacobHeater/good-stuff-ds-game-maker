import type { FpsTarget } from "@goodstuff/core";
import { DS_HARDWARE_PROFILE } from "@goodstuff/core";

import { useEditorStore, type ScreenFilter, type WorkspaceId } from "../state/editor-store";

const WORKSPACES: WorkspaceId[] = ["2D", "3D", "Script", "Game"];
const SCREEN_FILTERS: { id: ScreenFilter; label: string }[] = [
  { id: "both", label: "Both Screens" },
  { id: "top", label: "Top Screen" },
  { id: "bottom", label: "Bottom Screen" }
];
/** The DS's 3D engine can only drive one screen at a time, so "Both" isn't a valid choice there. */
const SCREEN_FILTERS_3D = SCREEN_FILTERS.filter((option) => option.id !== "both");

function tabClasses(active: boolean): string {
  return active
    ? "rounded bg-editor-accent px-3 py-1 text-xs font-medium text-editor-bg"
    : "rounded px-3 py-1 text-xs font-medium text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text";
}

/**
 * The bar directly under the menu: workspace switcher (Scene/Script/Game,
 * standing in for Godot's 2D/3D/Script/Game/AssetLib tabs), the screen
 * filter for the dual-screen viewport, the FPS target, and playtest controls.
 */
export function WorkspaceToolbar(): JSX.Element {
  const { state, setWorkspace, setScreenFilter, setFpsTarget, log } = useEditorStore();
  const is3D = state.activeWorkspace === "3D";

  const handleWorkspaceChange = (workspace: WorkspaceId): void => {
    setWorkspace(workspace);
    if (workspace === "3D" && state.screenFilter === "both") {
      setScreenFilter("top");
    }
  };

  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-editor-border bg-editor-panel px-3">
      <div className="flex items-center gap-1">
        {WORKSPACES.map((workspace) => (
          <button
            key={workspace}
            type="button"
            className={tabClasses(state.activeWorkspace === workspace)}
            onClick={() => handleWorkspaceChange(workspace)}
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
          {(is3D ? SCREEN_FILTERS_3D : SCREEN_FILTERS).map((option) => (
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
          onClick={() => log("Play pressed (no backend wired up yet).")}
          className="rounded bg-editor-accent px-3 py-1 text-xs font-semibold text-editor-bg hover:opacity-90"
        >
          ▶ Play
        </button>
      </div>
    </div>
  );
}
