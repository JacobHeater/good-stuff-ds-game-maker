import type { SceneNodeKind } from "@goodstuff/core";
import { SCENE_NODE_KINDS_2D, SCENE_NODE_KINDS_3D } from "@goodstuff/core";
import { useEffect, useRef, useState } from "react";

import { NODE_KIND_ICON } from "../node-icons";
import { useEditorStore } from "../state/editor-store";

function MenuItem({
  label,
  icon,
  disabled,
  onSelect
}: {
  label: string;
  icon?: string;
  disabled?: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
        disabled ? "cursor-not-allowed text-editor-text-muted/40" : "text-editor-text hover:bg-editor-accent/20"
      }`}
    >
      {icon && <span className="w-4 text-center">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}

function MenuSeparator(): JSX.Element {
  return <div className="my-1 h-px bg-editor-border" />;
}

function MenuSectionLabel({ label }: { label: string }): JSX.Element {
  return <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-editor-text-muted">{label}</div>;
}

/**
 * The "Scene" menu: Godot-style scene/node document actions. New/Open/
 * Save/Save As/Close all go through the real project persistence layer
 * (Electron main-process file I/O via the `window.goodstuff.project` bridge).
 */
export function SceneMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, newScene, addNode, deleteNode, duplicateNode, saveProject, saveProjectAs, openProject, closeProject } =
    useEditorStore();
  const hasSelection = state.selectedNodeId !== state.sceneRoot.id;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const runAndClose = (action: () => void) => (): void => {
    action();
    setOpen(false);
  };

  const addNodeOfKind = (kind: SceneNodeKind) => runAndClose(() => addNode(kind));

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded px-2 py-1 text-xs ${
          open ? "bg-editor-panel-alt text-editor-text" : "text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
        }`}
      >
        Scene
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-[75vh] w-56 overflow-y-auto rounded border border-editor-border bg-editor-panel py-1 shadow-lg">
          <MenuItem label="New Scene" onSelect={runAndClose(newScene)} />
          <MenuItem label="Open Project..." onSelect={runAndClose(() => openProject())} />

          <MenuSeparator />
          <MenuSectionLabel label="Add 2D Node" />
          {SCENE_NODE_KINDS_2D.map((kind) => (
            <MenuItem key={kind} label={kind} icon={NODE_KIND_ICON[kind]} onSelect={addNodeOfKind(kind)} />
          ))}

          <MenuSectionLabel label="Add 3D Node" />
          {SCENE_NODE_KINDS_3D.map((kind) => (
            <MenuItem key={kind} label={kind} icon={NODE_KIND_ICON[kind]} onSelect={addNodeOfKind(kind)} />
          ))}

          <MenuSeparator />
          <MenuItem
            label="Duplicate Node"
            disabled={!hasSelection}
            onSelect={runAndClose(() => duplicateNode(state.selectedNodeId))}
          />
          <MenuItem
            label="Delete Node"
            disabled={!hasSelection}
            onSelect={runAndClose(() => deleteNode(state.selectedNodeId))}
          />

          <MenuSeparator />
          <MenuItem label="Save Scene" onSelect={runAndClose(() => saveProject())} />
          <MenuItem label="Save Scene As..." onSelect={runAndClose(() => saveProjectAs())} />

          <MenuSeparator />
          <MenuItem label="Close Scene" onSelect={runAndClose(closeProject)} />
        </div>
      )}
    </div>
  );
}
