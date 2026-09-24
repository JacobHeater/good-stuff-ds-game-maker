import { useEffect } from "react";

import { StartupView } from "../startup/StartupView";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { MenuBar } from "./layout/MenuBar";
import { StatusBar } from "./layout/StatusBar";
import { WorkspaceToolbar } from "./layout/WorkspaceToolbar";
import { BottomPanel } from "./panels/BottomPanel";
import { FileSystemPanel } from "./panels/FileSystemPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { SceneTreePanel } from "./panels/SceneTreePanel";
import { EditorStoreProvider, useEditorStore } from "./state/editor-store";
import { DualScreenViewport } from "./viewport/DualScreenViewport";
import { Viewport3D } from "./viewport/Viewport3D";

function ActiveViewport(): JSX.Element {
  const { state } = useEditorStore();
  if (state.activeWorkspace === "3D") return <Viewport3D />;
  if (state.activeWorkspace === "2D") return <DualScreenViewport />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-editor-bg text-xs text-editor-text-muted">
      The {state.activeWorkspace} workspace isn't built yet.
    </div>
  );
}

function EditorWorkspace(): JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-editor-bg text-sm text-editor-text">
      <MenuBar />
      <WorkspaceToolbar />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-editor-border bg-editor-panel">
          <SceneTreePanel />
          <FileSystemPanel />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ActiveViewport />
          <BottomPanel />
        </div>
        <div className="w-72 shrink-0 border-l border-editor-border bg-editor-panel">
          <InspectorPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

function AppRoot(): JSX.Element {
  const { state, hasUnsavedChanges } = useEditorStore();

  // The window title (and taskbar entry) names the project and shows unsaved edits.
  useEffect(() => {
    document.title = state.project
      ? `${hasUnsavedChanges ? "● " : ""}${state.project.name} — Good Stuff DS Game Maker`
      : "Good Stuff DS Game Maker";
  }, [state.project, hasUnsavedChanges]);

  return (
    <>
      {state.project ? <EditorWorkspace /> : <StartupView />}
      <UnsavedChangesDialog />
    </>
  );
}

/**
 * Root of the app: the startup view (New Project / Open Existing Project)
 * while no project is open, and otherwise a Godot-style dock layout (scene
 * tree + filesystem on the left, viewport and bottom panel in the center,
 * inspector on the right) locked to the open project's 2D-or-3D mode.
 */
export function EditorShell(): JSX.Element {
  return (
    <EditorStoreProvider>
      <AppRoot />
    </EditorStoreProvider>
  );
}
