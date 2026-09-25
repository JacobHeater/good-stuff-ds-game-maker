import { createProjectSnapshot, createSceneNode, duplicateSceneNode, withUpdatedScene, type ProjectScript, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { JsonProjectSerializer } from "./json-project-serializer";
import { JsonSchemaProjectSnapshotValidator } from "./json-schema-project-snapshot-validator";

const validator = new JsonSchemaProjectSnapshotValidator();
const serializer = new JsonProjectSerializer();

const tricky: ProjectScript = {
  id: "s-1",
  name: "Player",
  source: '# éè 日本語 🎮\n\tvar x = 1\r\nfunc _process(delta):\n    pass "quoted" \\ back\n'
};
const idle: ProjectScript = { id: "s-2", name: "Unused", source: "func _ready():\n    pass\n" };

function projectWithScripts(): ProjectSnapshot {
  const a = createSceneNode({ name: "A", kind: "MeshInstance3D" });
  const b = createSceneNode({ name: "B", kind: "MeshInstance3D" });
  a.scriptId = tricky.id;
  b.scriptId = tricky.id;
  const scene = createSceneNode({ name: "Main", kind: "Node3D", children: [a, b] });
  return { ...createProjectSnapshot({ name: "P", mode: "3D", scene }), scripts: [tricky, idle] };
}
const roundTrip = (project: unknown): unknown => JSON.parse(serializer.serialize(project as ProjectSnapshot));
const issuesOf = (project: unknown): string[] => [...validator.validate(project).issues];

describe("scripts in the project file", () => {
  it("leaves a project without scripts unchanged: no scripts key, no scriptId", () => {
    const plain = createProjectSnapshot({
      name: "P",
      mode: "3D",
      scene: createSceneNode({ name: "Main", kind: "Node3D", children: [createSceneNode({ name: "A", kind: "MeshInstance3D" })] })
    });
    const text = serializer.serialize(withUpdatedScene(plain, plain.scene));
    expect(text).not.toContain('"scripts"');
    expect(text).not.toContain('"scriptId"');
    expect(validator.validate(roundTrip(plain)).valid).toBe(true);
  });

  it("round-trips scripts (line breaks, tabs, quotes, backslashes, non-ASCII) and attachments identically", () => {
    const reopened = validator.assertValid(serializer.deserialize(serializer.serialize(projectWithScripts())));
    expect(reopened.scripts).toEqual([tricky, idle]);
    expect(reopened.scene.children.map((c) => c.scriptId)).toEqual(["s-1", "s-1"]);
  });

  it("keeps an unattached script when the scene is saved", () => {
    const project = projectWithScripts();
    expect(withUpdatedScene(project, project.scene).scripts).toEqual([tricky, idle]);
    const bare = createSceneNode({ name: "Main", kind: "Node3D" });
    expect(withUpdatedScene(project, bare).scripts).toEqual([tricky, idle]); // even with nothing using either
  });

  it("rejects a node that names a script the file doesn't contain, naming the node and the id", () => {
    const project = projectWithScripts();
    delete project.scripts;
    const issues = issuesOf(roundTrip(project));
    expect(issues).toHaveLength(2);
    for (const name of ["A", "B"]) expect(issues.join(" | ")).toMatch(new RegExp(`Node "${name}" uses the script "s-1", which isn't in the project file`));
  });

  it("rejects duplicate ids, an empty name, a source that isn't a string and unknown fields", () => {
    const project = projectWithScripts();
    project.scripts = [tricky, { ...tricky }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/another script already uses/);
    project.scripts = [{ ...tricky, name: "  " }];
    expect(issuesOf(roundTrip(project)).join(" ")).toMatch(/\/scripts\/0\/name is empty/);
    const junk = roundTrip(projectWithScripts()) as { scripts: Array<{ source: unknown }> };
    junk.scripts[0].source = 42;
    expect(validator.validate(junk).valid).toBe(false);
    const extra = roundTrip(projectWithScripts()) as { scripts: Array<Record<string, unknown>> };
    extra.scripts[0].language = "gdscript";
    expect(validator.validate(extra).valid).toBe(false);
  });

  it("keeps the attachment when a node is duplicated", () => {
    const original = projectWithScripts().scene.children[0];
    expect(duplicateSceneNode(original).scriptId).toBe("s-1");
  });
});
