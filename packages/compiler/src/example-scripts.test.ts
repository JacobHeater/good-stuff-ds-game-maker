import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, type ProjectSnapshot } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeProject } from "./fixtures";
import { writeScriptCodeC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

/** The example scripts in tests/prototypes/scripts compile in a scene set up the way their header says. */

const scriptPath = (name: string): string => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "prototypes", "scripts", name);

describe("camera-look.gsscript", () => {
  const source = readFileSync(scriptPath("camera-look.gsscript"), "utf-8");

  /** The cube fixture with the script attached to its camera, as the script's header says. */
  function scene(): ProjectSnapshot {
    const base = cubeProject();
    const children = base.scene.children.map((n) => (n.kind === "Camera3D" ? { ...n, scriptId: "look" } : n));
    const project = createProjectSnapshot({ name: "Look", mode: "3D", scene: { ...base.scene, children } });
    return { ...project, scripts: [{ id: "look", name: "Look", source }] };
  }

  it("has no errors or warnings when attached to the camera", () => {
    const { scene: built, diagnostics } = translateScene3D(scene());
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.filter((d) => d.code === "script-warning")).toEqual([]);
    expect(built).not.toBeNull();
  });

  it("turns the camera about the up axis only: it writes the camera's Y rotation and nothing else", () => {
    const { scene: built } = translateScene3D(scene());
    expect(built!.nodes[built!.camera.node].dynamic).toBe(true); // the runtime recomputes the camera's view every frame
    const code = writeScriptCodeC(built!);
    expect(code).toMatch(/\.rotation\[1\] = /);
    expect(code).not.toMatch(/\.rotation\[0\] = /); // never tilts
    expect(code).not.toMatch(/\.rotation\[2\] = /); // never rolls
  });
});
