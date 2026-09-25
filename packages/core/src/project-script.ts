/**
 * A script in a project (requirements/scripting/STORY.write-and-run-scripts.md): what the user wrote, embedded in the project
 * file. Unlike an imported model, texture or sound it is never dropped for being unused, since it is the user's own work.
 * A node uses one with `SceneNode.scriptId`.
 */
export interface ProjectScript {
  id: string;
  /** What the user calls it; shown in the Script tab and the Inspector. */
  name: string;
  source: string;
}

/** The starting text of a new script. */
export const NEW_SCRIPT_SOURCE = `func _ready():
    pass

func _process(delta):
    pass
`;

/** A name for a new script that no existing one has: Script, Script2, Script3, ... */
export function uniqueScriptName(existing: readonly { name: string }[], base = "Script"): string {
  const names = new Set(existing.map((script) => script.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}
