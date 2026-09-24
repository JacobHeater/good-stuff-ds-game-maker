import { useEditorStore } from "../state/editor-store";
import { MenuDropdown, MenuItem, MenuSeparator } from "./menu-primitives";

/**
 * The "Project" menu: what acts on the project as a whole — open, save, save as,
 * export a ROM, close. It never touches the scene's contents (that's `SceneMenu`);
 * see `requirements/project-menu/EPIC.project-menu.md` for the ownership rule.
 */
export function ProjectMenu(): JSX.Element {
  const { openProject, saveProject, saveProjectAs, exportRom, exporting, closeProject } = useEditorStore();

  return (
    <MenuDropdown label="Project">
      {(run) => (
        <>
          <MenuItem label="Open Project..." onSelect={run(() => void openProject())} />
          <MenuSeparator />
          <MenuItem label="Save Project" onSelect={run(() => void saveProject())} />
          <MenuItem label="Save Project As..." onSelect={run(() => void saveProjectAs())} />
          <MenuSeparator />
          <MenuItem
            label={exporting ? "Exporting ROM..." : "Export ROM..."}
            disabled={exporting}
            onSelect={run(() => void exportRom())}
          />
          <MenuSeparator />
          <MenuItem label="Close Project" onSelect={run(closeProject)} />
        </>
      )}
    </MenuDropdown>
  );
}
