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
  return state.activeWorkspace === "3D" ? <Viewport3D /> : <DualScreenViewport />;
}

/**
 * Root layout of the designer experience: a Godot-editor-style dock
 * arrangement (scene tree + filesystem on the left, dual-screen viewport and
 * bottom panel in the center, inspector on the right) adapted for authoring
 * Nintendo DS games.
 */
export function EditorShell(): JSX.Element {
  return (
    <EditorStoreProvider>
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
    </EditorStoreProvider>
  );
}
