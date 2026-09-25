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
 * A platformer authored entirely through the editor UI, run on the emulator (requirements/collision/STORY.solid-shapes-and-move-and-collide.md, "A whole game";
 * tests/prototypes/e2e/platformer.mjs prints where it saved one, and GSDS_PLATFORMER_ROM_PROJECT=<that path> runs this). The project is a player with a body
 * shape, a solid floor and a solid wall (each with a visible mesh) and the example player script. The player starts 2 units up: it must fall onto the floor
 * and stand there; with Right held it must walk into the wall and stop against it. The pictures are compared with renders of the same project without the
 * script, the player set by hand where it should be.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

describe.skipIf(!toolchain.found || !haveMelon || !process.env.GSDS_PLATFORMER_ROM_PROJECT)("the platformer authored in the editor UI, in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-platformer-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  it("falls onto the floor and stands there, and walks into the wall and stops against it", async () => {
    const saved = JSON.parse(readFileSync(process.env.GSDS_PLATFORMER_ROM_PROJECT!, "utf-8"));
    const find = (node: any, name: string): any => (node.name === name ? node : node.children.map((c: any) => find(c, name)).find(Boolean));
    /** The same project without the script, the player put at (x, y). */
    const variant = (x: number, y: number) => {
      const copy = structuredClone(saved);
      delete copy.scripts;
      const strip = (node: any): void => {
        delete node.scriptId;
        node.children.forEach(strip);
      };
      strip(copy.scene);
      Object.assign(find(copy.scene, "Player").transform3D.position, { x, y });
      return copy;
    };
    const start = find(saved.scene, "Player").transform3D.position;
    const rom = join(work, "platformer.nds");
    const built = await compileProject(saved, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "warning")).toEqual([]);

    // Standing: the floor's top is at y = 0, so a unit box rests at 0.5 (plus a hair).
    const idle = captureRomWithInput(rom, join(work, "idle.png"), { holdSeconds: 2 });
    const standing = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(start.x, 0.51)));
    const stillInAir = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(start.x, start.y)));
    console.info(`[platformer] nothing pressed: matches the player standing on the floor ${standing.toFixed(3)}, still where it started ${stillInAir.toFixed(3)}`);
    expect(standing, "it fell onto the floor and stands there").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(standing).toBeGreaterThan(stillInAir);

    // Walking into the wall: its face is at x = 2.5, so the player (half width 0.5) stops at about 2.
    const held = captureRomWithInput(rom, join(work, "held.png"), { hold: ["right"], holdSeconds: 5 });
    copyFileSync(join(work, "held.png"), join(tmpdir(), "gsds-platformer.png"));
    const atWall = silhouetteIoU(held.silhouette, referenceSilhouette(variant(1.99, 0.51)));
    const throughWall = silhouetteIoU(held.silhouette, referenceSilhouette(variant(3.5, 0.51)));
    const barelyMoved = silhouetteIoU(held.silhouette, referenceSilhouette(variant(1.0, 0.51)));
    console.info(`[platformer] Right held: matches the player stopped at the wall ${atWall.toFixed(3)}, through it ${throughWall.toFixed(3)}, halfway ${barelyMoved.toFixed(3)}`);
    expect(atWall, "it walked to the wall and stopped").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(atWall).toBeGreaterThan(throughWall);
    expect(atWall).toBeGreaterThan(barelyMoved);
  }, 300_000);
});
