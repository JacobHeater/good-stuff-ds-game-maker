import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildArm, flattenSceneTree, importGltf, type ProjectSnapshot } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { primitivesProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_2D_PROJECT, shown } from "./sprite-reference";

/**
 * A rigged model imported from glTF, in a real ROM (requirements/scene-designer/STORY.rigged-models.md): a two-bone arm (built in the test as glTF bytes) stands upright; its clip bends the arm bone 90 degrees, which swings the
 * upper half of the model out to the side. The picture says which: where the model's pixels are.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

function project(playing: boolean): ProjectSnapshot {
  const built = buildArm({ animation: true });
  const r = importGltf({ json: built.json, buffers: [built.bin] }, "Robot");
  if (!r.ok) throw new Error(r.errors.join(" "));
  if (playing) {
    const player = flattenSceneTree(r.model.root).find((n) => n.kind === "AnimationPlayer")!;
    player.animation!.autoplay = player.animation!.animations![0].id;
  }
  const base = primitivesProject();
  return { ...base, meshes: r.model.meshes, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), r.model.root] } };
}

/** The model's pixels of the top screen in the left third, the middle third and the right third. */
function thirds(screen: Uint8Array): [number, number, number] {
  const [br, bg, bb] = BACKDROP_2D_PROJECT.top.map(shown);
  const counts: [number, number, number] = [0, 0, 0];
  for (let y = 4; y < 188; y++) {
    for (let x = 4; x < 252; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) counts[x < 108 ? 0 : x < 148 ? 1 : 2]++;
    }
  }
  return counts;
}

describe.skipIf(!toolchain.found || !haveMelon)("a rigged model in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-rigged-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(p: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(p, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return thirds(captureBothScreens(rom, join(work, `${name}.png`)).top);
  }

  it("stands upright at rest, and its arm swings out to the side when the imported clip plays", async () => {
    const still = await run(project(false), "still");
    const bent = await run(project(true), "bent");
    console.info(`[rigged] at rest left/middle/right ${still.join("/")}; clip playing ${bent.join("/")}`);
    expect(still[1]).toBeGreaterThan(300);
    expect(still[0]).toBe(0);
    expect(still[2]).toBe(0);
    expect(bent[0]).toBeGreaterThan(100); // the arm has swung out to the left
    expect(bent[1]).toBeGreaterThan(100); // the hip's part is still standing
  }, 240_000);
});
