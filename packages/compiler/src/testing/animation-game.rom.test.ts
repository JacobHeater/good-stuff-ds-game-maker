import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { captureRomWithInput } from "./emulator-capture";
import { referenceSilhouette, silhouetteIoU } from "./reference-render";

/**
 * Animations authored entirely through the editor UI, run on the emulator (requirements/animation/STORY.animation-player-node.md, "Autoplay on the DS" and
 * "A script starts it"; tests/prototypes/e2e/animation.mjs prints where it saved one, and GSDS_ANIMATION_ROM_PROJECT=<that path> runs this). The project is a cube
 * at x = -2 with an AnimationPlayer: "Slide" (autoplay: the cube goes to x = 2 over 2 s) and "Tilt" (a script plays it when A is pressed: the cube turns 0 to 45
 * degrees about Z over 1 s). The pictures are compared with renders of the same project with the animation player and script removed and the cube put by hand
 * where the animations should have left it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

describe.skipIf(!toolchain.found || !haveMelon || !process.env.GSDS_ANIMATION_ROM_PROJECT)("animations authored in the editor UI, in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-animation-game-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  it("the autoplay animation slides the cube to the right, and A starts the script's animation, which tilts it", async () => {
    const saved = JSON.parse(readFileSync(process.env.GSDS_ANIMATION_ROM_PROJECT!, "utf-8"));
    const find = (node: any, name: string): any => (node.name === name ? node : node.children.map((c: any) => find(c, name)).find(Boolean));
    /** The same project without the animation player and script, the cube put at x with a turn of `tilt` degrees. */
    const variant = (x: number, tilt: number) => {
      const copy = structuredClone(saved);
      delete copy.scripts;
      const strip = (node: any): void => {
        delete node.scriptId;
        node.children = node.children.filter((c: any) => c.kind !== "AnimationPlayer");
        node.children.forEach(strip);
      };
      strip(copy.scene);
      const cube = find(copy.scene, "Cube");
      cube.transform3D.position.x = x;
      cube.transform3D.rotation.z = tilt;
      return copy;
    };
    const rom = join(work, "animation.nds");
    const built = await compileProject(saved, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "warning")).toEqual([]);

    // Nothing pressed: Slide (autoplay) has moved the cube to x = 2 and left it there; nothing has tilted it.
    const idle = captureRomWithInput(rom, join(work, "idle.png"), { holdSeconds: 3 });
    const slid = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(2, 0)));
    const stayed = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(-2, 0)));
    const tilted = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(2, 45)));
    console.info(`[animation] nothing pressed: matches the cube slid to x = 2 ${slid.toFixed(3)}, still at x = -2 ${stayed.toFixed(3)}, slid and tilted ${tilted.toFixed(3)}`);
    expect(slid, "the autoplay animation slid the cube").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(slid).toBeGreaterThan(stayed);
    expect(slid).toBeGreaterThan(tilted);

    // A tapped: the script plays Tilt, which turns the cube 45 degrees.
    const pressed = captureRomWithInput(rom, join(work, "pressed.png"), { tap: ["a"], holdSeconds: 3 });
    copyFileSync(join(work, "pressed.png"), join(tmpdir(), "gsds-animation.png"));
    const turned = silhouetteIoU(pressed.silhouette, referenceSilhouette(variant(2, 45)));
    const notTurned = silhouetteIoU(pressed.silhouette, referenceSilhouette(variant(2, 0)));
    console.info(`[animation] A tapped: matches the cube slid and tilted ${turned.toFixed(3)}, slid only ${notTurned.toFixed(3)}`);
    expect(turned, "the script's animation tilted it").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(turned).toBeGreaterThan(notTurned);
  }, 300_000);
});
