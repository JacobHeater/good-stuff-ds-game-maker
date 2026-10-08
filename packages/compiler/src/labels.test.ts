import { createProjectSnapshot, createSceneNode, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { cString, fontSafeText } from "./label-text";
import { writeScene2DDataC, writeSceneDataC } from "./scene-data-writer";
import { translateScene2D } from "./translate-scene-2d";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.labels-and-text.md (the parts that need no toolchain) */

function label(name: string, x: number, y: number, text: string, color = 7, extra: Partial<SceneNode> = {}): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "top", position: { x, y } }), label: { text, color }, ...extra };
}

function project2D(children: SceneNode[]): ProjectSnapshot {
  return createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) });
}

function project3D(children: SceneNode[], scripts: ProjectSnapshot["scripts"] = []): ProjectSnapshot {
  const base = cubeProject();
  return { ...base, scene: { ...base.scene, children: [...base.scene.children, ...children] }, scripts };
}

describe("compiling labels into a 2D project", () => {
  it("puts each label in its grid cell with its color and text, on the screen it is on", () => {
    const bottom = label("Hint", 16, 40, "Touch to start", 3, { screen: "bottom" });
    const { scene, diagnostics } = translateScene2D(project2D([label("Title", 12, 4, "Hello", 1), bottom]));
    expect(diagnostics).toEqual([]);
    // 12 / 8 = 1.5 rounds to column 2; 4 / 8 = 0.5 rounds to row 1
    expect(scene!.top.labels).toEqual([{ name: "Title", column: 2, row: 1, color: 1, text: "Hello", node: -1, visible: true }]);
    expect(scene!.bottom.labels).toEqual([{ name: "Hint", column: 2, row: 5, color: 3, text: "Touch to start", node: -1, visible: true }]);
  });

  it("leaves out a hidden label, and one whose first cell is off the screen (with a warning)", () => {
    const { scene, diagnostics } = translateScene2D(project2D([label("Hidden", 0, 0, "x", 7, { visible: false }), label("Far", 300, 0, "x"), label("Below", 0, 200, "x")]));
    expect(scene!.top.labels).toEqual([]);
    expect(diagnostics.filter((d) => d.code === "label-off-screen").map((d) => d.nodeName)).toEqual(["Far", "Below"]);
  });

  it("refuses more labels than a screen's text layer tracks", () => {
    const many = Array.from({ length: 33 }, (_, i) => label(`L${i}`, 0, (i % 24) * 8, "x"));
    expect(translateScene2D(project2D(many)).diagnostics.find((d) => d.code === "too-many-labels")).toMatchObject({ severity: "error" });
  });

  it("no longer says a Label isn't built", () => {
    const { diagnostics } = translateScene2D(project2D([label("A", 0, 0, "x")]));
    expect(diagnostics.some((d) => d.code === "two-d-node-not-built")).toBe(false);
  });

  it("writes the labels as C, with the text escaped and anything the font lacks turned into a question mark", () => {
    const { scene } = translateScene2D(project2D([label("Q", 0, 0, 'say "hi" \\ what?? é')]));
    const c = writeScene2DDataC(scene!);
    expect(c).toContain('{ 0, 0, 7, 1, -1, "say \\"hi\\" \\\\ what\\?\\? \\?" }');
    expect(c).toContain("1, top_labels");
  });
});

describe("text the DS's font can show", () => {
  it("keeps printable ASCII, turns line breaks into spaces and the rest into ?", () => {
    expect(fontSafeText("a\nb\tc é")).toBe("a b c ?");
    expect(cString('a"b\\c?')).toBe('"a\\"b\\\\c\\?"');
  });
});

describe("labels on the 2D screen of a 3D project", () => {
  it("come with their node, so a script can show, hide and change them", () => {
    const score = label("Score", 8, 8, "Score: {}");
    const scripts = [{ id: "s", name: "S", source: "var n = 0\n\nfunc _process(delta):\n    n += 1\n    $Score.value = n\n    $Score.visible = n < 100\n" }];
    const cube = cubeProject();
    const withScript: ProjectSnapshot = {
      ...project3D([score], scripts),
      scene: { ...cube.scene, children: [...cube.scene.children.map((n) => (n.name === "Cube" ? { ...n, scriptId: "s" } : n)), score] }
    };
    const { scene, diagnostics } = translateScene3D(withScript);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const labels = scene!.sprites2D.labels;
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ name: "Score", column: 1, row: 1, text: "Score: {}", visible: true });
    expect(scene!.nodes[labels[0].node!].name).toBe("Score");
    expect(scene!.scriptCode).toContain(`gs_label_set_value(${labels[0].node}, `);
    const c = writeSceneDataC(scene!);
    expect(c).toContain(`{ 1, 1, 7, 1, ${labels[0].node}, "Score: {}" }`);
  });

  it("compiles $Label.text = ... to a call with the text as a C string", () => {
    const score = label("Msg", 0, 0, "hi");
    const cube = cubeProject();
    const project: ProjectSnapshot = {
      ...cube,
      scene: { ...cube.scene, children: [...cube.scene.children.map((n) => (n.name === "Cube" ? { ...n, scriptId: "s" } : n)), score] },
      scripts: [{ id: "s", name: "S", source: 'func _ready():\n    $Msg.text = "Game Over"\n' }]
    };
    const { scene, diagnostics } = translateScene3D(project);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(scene!.scriptCode).toMatch(/gs_label_set_text\(\d+, "Game Over"\);/);
  });

  it("keeps a label a script can show but which starts hidden", () => {
    const hidden = label("Later", 0, 0, "x", 7, { visible: false });
    const cube = cubeProject();
    const project: ProjectSnapshot = {
      ...cube,
      scene: { ...cube.scene, children: [...cube.scene.children.map((n) => (n.name === "Cube" ? { ...n, scriptId: "s" } : n)), hidden] },
      scripts: [{ id: "s", name: "S", source: "func _process(delta):\n    $Later.visible = true\n" }]
    };
    const { scene } = translateScene3D(project);
    expect(scene!.sprites2D.labels[0]).toMatchObject({ name: "Later", visible: false });
  });
});
