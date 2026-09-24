import { ProjectMenu } from "./ProjectMenu";
import { SceneMenu } from "./SceneMenu";

const PLACEHOLDER_MENUS = ["Debug", "Editor", "Help"] as const;

/**
 * Top menu strip, mirroring Godot's Scene / Project / Debug / Editor / Help menus.
 * "Scene" (node editing) and "Project" (project-file lifecycle) are real
 * dropdowns wired to the editor store; the rest remain visual-only placeholders.
 */
export function MenuBar(): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-editor-border bg-editor-panel px-2 text-xs">
      <span className="mr-2 font-semibold text-editor-accent">Good Stuff DS Game Maker</span>
      <SceneMenu />
      <ProjectMenu />
      {PLACEHOLDER_MENUS.map((menu) => (
        <button
          key={menu}
          type="button"
          className="rounded px-2 py-1 text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
        >
          {menu}
        </button>
      ))}
    </div>
  );
}
