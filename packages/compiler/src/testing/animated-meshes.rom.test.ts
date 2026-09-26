import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, mergeMeshFrames, type ImportedMesh, type ProjectSnapshot, type SceneNode, type SpriteAnimation } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { primitivesProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_2D_PROJECT, shown } from "./sprite-reference";

/**
 * Frame animations of 3D models in real ROMs (requirements/scene-designer/STORY.animated-3d-models.md): a model with three poses of a quad (far left, middle, far right of the picture),
 * an animation that has to move on by itself to the last pose, and a script that starts one by name. The picture says which pose is showing: where the quad's pixels are.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

function quad(name: string, x0: number): ImportedMesh {
  return { id: name, name, positions: [x0, 0, 0, x0 + 1.2, 0, 0, x0 + 1.2, 1.2, 0, x0, 1.2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3] };
}
const merged = mergeMeshFrames([quad("poses", -2.5), quad("p2", -0.6), quad("p3", 1.3)]);
if (!merged.ok) throw new Error("should merge");
const model: ImportedMesh = { ...merged.mesh, id: "poses" };

function project(animations: SpriteAnimation[], start: string | undefined, script?: string): ProjectSnapshot {
  const base = primitivesProject();
  const hero: SceneNode = {
    ...createSceneNode({ name: "Hero", kind: "MeshInstance3D", transform3D: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }),
    mesh: { importedMeshId: "poses", triangleCount: 2 },
    spriteAnimations: { animations, ...(start ? { start } : {}) },
    ...(script ? { scriptId: "s" } : {})
  };
  return {
    ...base,
    meshes: [model],
    scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), hero] },
    ...(script ? { scripts: [{ id: "s", name: "S", source: script }] } : {})
  };
}

/** How many pixels of the top screen differ from the backdrop in the left third, the middle third and the right third. */
function thirds(screen: Uint8Array): [number, number, number] {
  const [br, bg, bb] = BACKDROP_2D_PROJECT.top.map(shown);
  const counts: [number, number, number] = [0, 0, 0];
  for (let y = 4; y < 188; y++) {
    for (let x = 4; x < 252; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) counts[Math.min(2, Math.floor(x / 85))]++;
    }
  }
  return counts;
}

describe.skipIf(!toolchain.found || !haveMelon)("animated 3D models in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-mesh-anim-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(p: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(p, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return thirds(captureBothScreens(rom, join(work, `${name}.png`)).top);
  }

  const hold: SpriteAnimation = { name: "hold", frames: [0], fps: 8, loop: false };
  const go: SpriteAnimation = { name: "go", frames: [0, 1, 2], fps: 60, loop: false };

  it("shows the first pose when nothing plays, and the last when the animation has run to its end", async () => {
    const still = await run(project([hold, go], "hold"), "still");
    const running = await run(project([hold, go], "go"), "running");
    console.info(`[mesh] holding pose 0: left/middle/right ${still.join("/")}; running to pose 2: ${running.join("/")}`);
    expect(still[0]).toBeGreaterThan(200);
    expect(still[2]).toBe(0);
    expect(running[2]).toBeGreaterThan(200);
    expect(running[0]).toBe(0);
  }, 240_000);

  it("shows the last pose after a script starts the animation by name", async () => {
    const started = await run(project([hold, go], "hold", 'func _ready():\n    play("go")\n'), "scripted");
    console.info(`[mesh] script plays go: ${started.join("/")}`);
    expect(started[2]).toBeGreaterThan(200);
    expect(started[0]).toBe(0);
  }, 240_000);
});
