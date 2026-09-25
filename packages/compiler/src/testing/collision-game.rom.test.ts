import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { scriptedProject } from "../fixtures";
import { captureRomWithInput } from "./emulator-capture";
import { referenceSilhouette, silhouetteIoU } from "./reference-render";

/**
 * Collision in a real game loop, on the emulator (requirements/collision/STORY.collision-shapes-and-overlap-checks.md, "Overlap in a real ROM"): a
 * script moves a player with the D-pad and shows a flag exactly while the player's shape overlaps a wall's. The pictures are compared with renders of
 * the same scene, with the player and the flag set by hand where the script should have put them. Needs melonDS and a desktop session.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

const cube = (name: string, position: { x: number; y: number; z: number }, size: number, children: SceneNode[] = []): SceneNode =>
  createSceneNode({
    name,
    kind: "MeshInstance3D",
    mesh: "cube",
    children,
    transform3D: { position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: size, y: size, z: size } }
  });
const box = (name: string): SceneNode => {
  const node = createSceneNode({ name, kind: "CollisionShape3D", transform3D: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
  node.collision = { shape: "box", size: { x: 1, y: 1, z: 1 } };
  return node;
};

/** The wall's box and the player's box (each a unit box on a unit cube) overlap when their centers are less than 1 apart along X. */
const WALL_X = 2.2;
const START_X = -1.5;
const STOP_X = 1.6; // past 1.2, so the shapes overlap when the player gets there

/** The scene: a player cube (with its shape) at `playerX`, a wall cube (with its shape), and a flag cube, shown or hidden. */
function scene(playerX: number, flagShown: boolean): SceneNode[] {
  const flag = cube("Flag", { x: 0, y: 1.9, z: -0.5 }, 1.3);
  flag.visible = flagShown;
  return [cube("Player", { x: playerX, y: -0.9, z: 0.5 }, 1, [box("PlayerShape")]), cube("Wall", { x: WALL_X, y: -0.9, z: 0.5 }, 1, [box("WallShape")]), flag];
}

const SCRIPT = `func _process(delta):
    if Input.is_button_down("right"):
        position.x = min(position.x + 0.05, ${STOP_X})
    $Flag.visible = $PlayerShape.overlaps($WallShape)
`;

describe.skipIf(!toolchain.found || !haveMelon)("a script reacts to shapes touching, in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-collision-game-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  it("shows the flag only while the player's shape overlaps the wall's: hidden at the start, shown once the D-pad has moved the player into the wall", async () => {
    const project = scriptedProject([{ name: "Player", source: SCRIPT, attachTo: ["Player"] }], scene(START_X, false));
    const rom = join(work, "game.nds");
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    // No warning about the shapes being unused: the script checks them.
    expect(built.diagnostics.filter((d) => d.code === "collision-shape-unused")).toEqual([]);

    const reference = (playerX: number, flag: boolean) => referenceSilhouette(scriptedProject([], scene(playerX, flag)));

    const idle = captureRomWithInput(rom, join(work, "idle.png"), { holdSeconds: 1.5 });
    const idleRight = silhouetteIoU(idle.silhouette, reference(START_X, false));
    const idleWrong = silhouetteIoU(idle.silhouette, reference(START_X, true));
    console.info(`[collision-game] nothing pressed: matches (player at ${START_X}, flag hidden) ${idleRight.toFixed(3)}, with the flag shown ${idleWrong.toFixed(3)}`);
    expect(idleRight, "apart: the flag is hidden").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(idleRight).toBeGreaterThan(idleWrong);

    const held = captureRomWithInput(rom, join(work, "held.png"), { hold: ["right"], holdSeconds: 3 });
    copyFileSync(join(work, "held.png"), join(tmpdir(), "gsds-collision-game.png"));
    const heldRight = silhouetteIoU(held.silhouette, reference(STOP_X, true));
    const heldWrong = silhouetteIoU(held.silhouette, reference(STOP_X, false));
    console.info(`[collision-game] Right held: matches (player at ${STOP_X}, flag shown) ${heldRight.toFixed(3)}, with the flag hidden ${heldWrong.toFixed(3)}`);
    expect(heldRight, "touching: the flag is shown").toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(heldRight).toBeGreaterThan(heldWrong);
  }, 300_000);

  // The same game authored through the real editor UI (tests/prototypes/e2e/collision-shapes.mjs prints where it saved one): its script moves the
  // player with the D-pad and shows the flag while the shapes overlap. The saved project is compiled as it is and compared with the same project
  // with the script removed and the player and flag set by hand.
  it.skipIf(!process.env.GSDS_COLLISION_ROM_PROJECT)("the game authored in the editor UI behaves the same way", async () => {
    const saved = JSON.parse(readFileSync(process.env.GSDS_COLLISION_ROM_PROJECT!, "utf-8"));
    const find = (node: any, name: string): any => (node.name === name ? node : node.children.map((c: any) => find(c, name)).find(Boolean));
    const variant = (playerX: number, flagShown: boolean) => {
      const copy = structuredClone(saved);
      delete copy.scripts;
      const strip = (node: any): void => {
        delete node.scriptId;
        node.children.forEach(strip);
      };
      strip(copy.scene);
      find(copy.scene, "Player").transform3D.position.x = playerX;
      find(copy.scene, "Flag").visible = flagShown;
      return copy;
    };
    const start = find(saved.scene, "Player").transform3D.position.x;
    const rom = join(work, "ui-game.nds");
    const built = await compileProject(saved, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.code === "collision-shape-unused")).toEqual([]);

    const idle = captureRomWithInput(rom, join(work, "ui-idle.png"), { holdSeconds: 1.5 });
    const idleRight = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(start, false)));
    const idleWrong = silhouetteIoU(idle.silhouette, referenceSilhouette(variant(start, true)));
    console.info(`[collision-game] UI-authored, nothing pressed: matches the flag hidden ${idleRight.toFixed(3)}, shown ${idleWrong.toFixed(3)}`);
    expect(idleRight).toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(idleRight).toBeGreaterThan(idleWrong);

    const held = captureRomWithInput(rom, join(work, "ui-held.png"), { hold: ["right"], holdSeconds: 3 });
    copyFileSync(join(work, "ui-held.png"), join(tmpdir(), "gsds-collision-ui-game.png"));
    const heldRight = silhouetteIoU(held.silhouette, referenceSilhouette(variant(STOP_X, true)));
    const heldWrong = silhouetteIoU(held.silhouette, referenceSilhouette(variant(STOP_X, false)));
    console.info(`[collision-game] UI-authored, Right held: matches the flag shown ${heldRight.toFixed(3)}, hidden ${heldWrong.toFixed(3)}`);
    expect(heldRight).toBeGreaterThanOrEqual(IOU_MINIMUM);
    expect(heldRight).toBeGreaterThan(heldWrong);
  }, 300_000);
});
