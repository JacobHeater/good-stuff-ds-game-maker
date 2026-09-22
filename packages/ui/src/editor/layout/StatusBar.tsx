import { DS_HARDWARE_PROFILE } from "@goodstuff/core";

import { useEditorStore } from "../state/editor-store";

/** Thin status strip: fps target, resolution, node count — quick-glance hardware context. */
export function StatusBar(): JSX.Element {
  const { state } = useEditorStore();
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-editor-border bg-editor-panel px-3 text-[11px] text-editor-text-muted">
      <span>
        {DS_HARDWARE_PROFILE.screens.width}×{DS_HARDWARE_PROFILE.screens.height} per screen ·{" "}
        {DS_HARDWARE_PROFILE.screens.count} screens
      </span>
      <span>Target {state.fpsTarget} FPS</span>
    </div>
  );
}
