import type { ProjectScript, SceneNode } from "@goodstuff/core";

import { buttonClasses, Field, inputClasses } from "./inspector-fields";

/**
 * A node's Script field in the Inspector (requirements/scripting/TASK.script-editor-and-attachment.md): none, or one of the project's scripts,
 * with New Script (creates one and attaches it) and Edit (opens it in the Script tab). Every node can have a script.
 */
export function ScriptField({
  node,
  scripts,
  onChoose,
  onNew,
  onEdit
}: {
  node: SceneNode;
  scripts: readonly ProjectScript[];
  onChoose: (scriptId: string | null) => void;
  onNew: () => void;
  onEdit: (scriptId: string) => void;
}): JSX.Element {
  const current = node.scriptId;
  const missing = current !== undefined && !scripts.some((script) => script.id === current);
  return (
    <div className="flex flex-col gap-1.5" data-testid="script-field">
      <Field label="Script">
        <select
          value={current ?? ""}
          onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)}
          className={inputClasses}
          aria-label="Script"
        >
          <option value="">None</option>
          {scripts.map((script) => (
            <option key={script.id} value={script.id}>
              {script.name}
            </option>
          ))}
          {missing && (
            <option value={current} disabled>
              (missing script)
            </option>
          )}
        </select>
      </Field>
      <div className="flex gap-2">
        <button type="button" onClick={onNew} className={buttonClasses}>
          New Script
        </button>
        <button type="button" disabled={current === undefined || missing} onClick={() => current !== undefined && onEdit(current)} className={buttonClasses}>
          Edit
        </button>
      </div>
    </div>
  );
}
