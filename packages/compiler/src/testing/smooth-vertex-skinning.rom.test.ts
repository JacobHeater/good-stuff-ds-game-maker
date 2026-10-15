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
 * Smooth skinning (STORY.smooth-vertex-skinning.md) in a real ROM: the same two-bone arm as rigged-models.rom.test.ts,
 * but one vertex of the Hip-bound mesh is split 50/50 between Hip and Arm (`buildArm({ splitWeight: true })`). Rigidly,
 * that mesh only ever follows Hip, which never moves, so it stands still even while the clip bends the arm. With
 * `smoothSkinning` on, that one vertex should follow the bend partway, visibly changing the mesh's own silhouette --
 * the actual hardware proof that `draw_mesh`'s new per-vertex blended-matrix path in main.c works, not just that it
 * compiles.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");

function project(smoothSkinning: boolean): ProjectSnapshot {
  const built = buildArm({ animation: true, splitWeight: true });
  const r = importGltf({ json: built.json, buffers: [built.bin] }, "Robot");
  if (!r.ok) throw new Error(r.errors.join(" "));
  const player = flattenSceneTree(r.model.root).find((n) => n.kind === "AnimationPlayer")!;
  player.animation!.autoplay = player.animation!.animations![0].id;
  const hipMesh = flattenSceneTree(r.model.root).find((n) => n.name.includes("Hip_mesh"))!;
  hipMesh.mesh!.smoothSkinning = smoothSkinning;
  const base = primitivesProject();
  return { ...base, meshes: r.model.meshes, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), r.model.root] } };
}

/** Both of the arm's meshes toggled smooth at once, not just Hip_mesh. */
function bothSmoothProject(): ProjectSnapshot {
  const built = buildArm({ animation: true, splitWeight: true });
  const r = importGltf({ json: built.json, buffers: [built.bin] }, "Robot");
  if (!r.ok) throw new Error(r.errors.join(" "));
  const player = flattenSceneTree(r.model.root).find((n) => n.kind === "AnimationPlayer")!;
  player.animation!.autoplay = player.animation!.animations![0].id;
  for (const node of flattenSceneTree(r.model.root)) if (node.kind === "MeshInstance3D" && node.mesh?.importedMeshId) node.mesh.smoothSkinning = true;
  const base = primitivesProject();
  return { ...base, meshes: r.model.meshes, scene: { ...base.scene, children: [...base.scene.children.filter((n) => n.kind !== "MeshInstance3D"), r.model.root] } };
}

/** The model's pixels of the top screen in the left third, the middle third and the right third (same split as rigged-models.rom.test.ts). */
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

describe.skipIf(!toolchain.found || !haveMelon)("smooth skinning in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-skinning-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function run(p: ProjectSnapshot, name: string) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(p, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return thirds(captureBothScreens(rom, join(work, `${name}.png`)).top);
  }

  it("moves a split-weight vertex partway with the bend when smooth-skinned, unlike the rigid mesh it's otherwise identical to", async () => {
    const rigid = await run(project(false), "rigid");
    const smooth = await run(project(true), "smooth");
    console.info(`[skinning] rigid left/middle/right ${rigid.join("/")}; smooth-skinned ${smooth.join("/")}`);
    // Both builds compile and draw something.
    expect(rigid[1]).toBeGreaterThan(0);
    expect(smooth[1]).toBeGreaterThan(0);
    // The rigid Hip_mesh never moves (Hip itself is never animated), so its silhouette is identical with the clip
    // playing whether or not the toggle is set -- except the smooth-skinned one, where the split vertex follows the
    // arm's bend partway, changing the mesh's own shape (and so its pixel footprint) from the purely rigid version.
    expect(smooth.join("/")).not.toBe(rigid.join("/"));
  }, 240_000);

  it("still draws the model when every one of its meshes is smooth-skinned at once, not just one", async () => {
    // Regression: draw_skinned_mesh's own glLoadMatrix4x4 calls replace MODELVIEW outright, per vertex, instead of
    // building on whatever glPushMatrix saved -- so the camera's own view transform never reached the GPU for a
    // smooth-skinned mesh unless main.c folded it back in by hand. A single mesh near its bind pose can still land
    // in frame by coincidence (the arm case above did, which is why it went unnoticed); a whole rigged model with
    // every mesh smooth-skinned reliably did not, rendering nothing at all. See main.c's draw_skinned_mesh comment.
    const both = await run(bothSmoothProject(), "both-smooth");
    expect(both[1]).toBeGreaterThan(0);
  }, 120_000);
});
