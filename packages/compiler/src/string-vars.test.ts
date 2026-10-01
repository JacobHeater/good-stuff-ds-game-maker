import { type ProjectScript, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scripting/STORY.string-variables.md: `var`/member/local string variables in the generated C. */

function withScripts(scripts: ProjectScript[], attach: Record<string, string> = { Cube: scripts[0].id }): ProjectSnapshot {
  const base = cubeProject();
  return { ...base, scene: { ...base.scene, children: base.scene.children.map((n): SceneNode => (attach[n.name] ? { ...n, scriptId: attach[n.name] } : n)) }, scripts };
}
const script = (id: string, source: string): ProjectScript => ({ id, name: id, source });
const errorsOf = (r: { diagnostics: Array<{ severity: string; message: string }> }) => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("string member/local variables in generated code", () => {
  it("a member string variable is a real const char* field in the node's state struct, with its literal as the initial value", () => {
    const a = script("a", 'var name = "Rex"\n\nfunc _ready():\n    name = "Max"\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain('const char* m_name; /* string */');
    expect(scene!.scriptCode).toContain('{ "Rex" }');
    expect(scene!.scriptCode).toContain('gss0_state[inst].m_name = "Max";');
  });

  it("a local string variable is a real const char*, assignable from a literal or another string variable", () => {
    const a = script("a", 'var name = "Rex"\n\nfunc _ready():\n    var greeting = "Hi"\n    greeting = name\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain('const char* v_greeting = "Hi";');
    expect(scene!.scriptCode).toContain("v_greeting = gss0_state[inst].m_name;");
  });

  it("== and != on strings compile to strcmp, not pointer equality", () => {
    const a = script("a", 'var name = "Rex"\n\nfunc same(other: string) -> bool:\n    return name == other\n\nfunc different(other: string) -> bool:\n    return name != other\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain("(strcmp(gss0_state[inst].m_name, p_other) == 0)");
    expect(scene!.scriptCode).toContain("(strcmp(gss0_state[inst].m_name, p_other) != 0)");
  });

  it("a function taking and returning a string uses const char* in its C signature", () => {
    const a = script("a", 'func greet(who: string) -> string:\n    return who\n\nfunc _ready():\n    var g = greet("Rex")\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain("static const char* gss0_greet(int inst, const char* p_who)");
  });

  it("a literal with a non-ASCII character is replaced the same way label text is (the DS font is ASCII only)", () => {
    const a = script("a", 'var s = "café"\n\nfunc _ready():\n    pass\n');
    const { scene, diagnostics } = translateScene3D(withScripts([a]));
    expect(errorsOf({ diagnostics })).toEqual([]);
    expect(scene!.scriptCode).toContain('{ "caf\\?" }'); // the ? itself is escaped too, so it can't start a trigraph
  });
});
