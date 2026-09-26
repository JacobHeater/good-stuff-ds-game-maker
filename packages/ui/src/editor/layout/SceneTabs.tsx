import { listScenes, withSceneTree } from "@goodstuff/core";
import { useEffect, useState } from "react";

import { useEditorStore } from "../state/editor-store";

/** What a scene tab carries when it is dragged: the scene's id. Dropped on the Scene tree it puts an instance of that scene in the open scene (like Godot's instanced scenes). */
export const SCENE_DRAG_TYPE = "application/x-gsds-scene";

/**
 * The project's scenes as tabs above the viewport (requirements/scene-designer/STORY.multiple-scenes.md): click one to edit it, double-click its name to rename it, "+" adds an
 * empty scene. The tab of the scene being edited also has buttons to duplicate it, make it the scene the game starts in (the star) and delete it. The starting scene's tab is starred.
 * Hidden until there is a project. Every scene shares the project's models, textures, sounds, images and scripts.
 */
export function SceneTabs(): JSX.Element | null {
  const { state, switchScene, addScene, renameScene, deleteScene, duplicateScene, setStartScene } = useEditorStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  useEffect(() => setRenaming(null), [state.activeSceneId]);
  if (!state.project) return null;
  const scenes = listScenes(withSceneTree(state.project, state.activeSceneId, state.sceneRoot));

  const commit = (id: string): void => {
    renameScene(id, text);
    setRenaming(null);
  };
  const small = "rounded px-1.5 py-0.5 text-[11px] text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text";
  return (
    <div className="flex items-center gap-1 border-b border-editor-border bg-editor-panel px-2 py-1" data-testid="scene-tabs" role="tablist" aria-label="Scenes">
      {scenes.map((scene) => {
        const active = scene.id === state.activeSceneId;
        return (
          <div key={scene.id} className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${active ? "border-editor-accent bg-editor-accent/20 text-editor-text" : "border-editor-border text-editor-text-muted"}`}>
            {renaming === scene.id ? (
              <input
                autoFocus
                value={text}
                data-testid="scene-rename"
                onChange={(event) => setText(event.target.value)}
                onBlur={() => commit(scene.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(scene.id);
                  if (event.key === "Escape") setRenaming(null);
                }}
                className="w-24 rounded border border-editor-border bg-editor-panel-alt px-1 text-xs text-editor-text"
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                draggable={!active}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SCENE_DRAG_TYPE, scene.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                data-testid={`scene-tab-${scene.name}`}
                title={`${scene.isStart ? `${scene.name} (the scene the game starts in)` : scene.name}${active ? "" : ". Drag it onto the Scene tree to add an instance of it to the scene being edited."}`}
                onClick={() => switchScene(scene.id)}
                onDoubleClick={() => {
                  setText(scene.name);
                  setRenaming(scene.id);
                }}
              >
                {scene.isStart && <span aria-hidden="true">★ </span>}
                {scene.name}
              </button>
            )}
            {active && renaming !== scene.id && (
              <>
                <button type="button" className={small} title="Duplicate this scene" data-testid="scene-duplicate" onClick={() => duplicateScene(scene.id)}>
                  Copy
                </button>
                {!scene.isStart && (
                  <button type="button" className={small} title="Make this the scene the game starts in" data-testid="scene-set-start" onClick={() => setStartScene(scene.id)}>
                    Start here
                  </button>
                )}
                {scenes.length > 1 && (
                  <button type="button" className={small} title="Delete this scene" data-testid="scene-delete" onClick={() => deleteScene(scene.id)}>
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <button type="button" className={small} title="Add an empty scene" data-testid="scene-add" onClick={() => addScene("Scene")}>
        + Scene
      </button>
    </div>
  );
}
