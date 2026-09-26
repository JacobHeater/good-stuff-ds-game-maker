import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, DEFAULT_START_SCENE_ID, withSceneEntries, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { cubeProject } from "../fixtures";
import { captureBothScreens } from "./emulator-capture";
import { BACKDROP_BLACK, shown } from "./sprite-reference";

/**
 * Global variables and the save file in real ROMs (requirements/scripting/STORY.game-state-and-save.md). The numbers are shown with labels on the 2D screen and read from the picture
 * by how wide the text is: a label `N{}` is one character for the N and one for each digit.
 *
 * The save file goes to an SD card, which melonDS only has when its DLDI setting is on, so the save test turns that on (with a new image file as the card) for its run and puts the
 * emulator's settings back after.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const localAppData = process.env.LOCALAPPDATA ?? "";
const haveMelon = existsSync(localAppData);

function melonConfigPath(): string | null {
  const packages = join(localAppData, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packages)) return null;
  for (const dir of readdirSync(packages)) {
    if (!dir.startsWith("melonDS")) continue;
    const config = join(packages, dir, "melonDS.toml");
    if (existsSync(config)) return config;
  }
  return null;
}

/** How many 8-pixel characters wide the text in the rows y0 to y1 of the bottom screen is, from its left edge at x = 8. */
function textWidth(screen: Uint8Array, y0: number, y1: number): number {
  const [br, bg, bb] = BACKDROP_BLACK.map(shown);
  let right = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 2; x < 254; x++) {
      const i = (y * 256 + x) * 3;
      if (Math.abs(screen[i] - br) > 24 || Math.abs(screen[i + 1] - bg) > 24 || Math.abs(screen[i + 2] - bb) > 24) right = Math.max(right, x);
    }
  }
  return right < 0 ? 0 : Math.floor((right - 8) / 8) + 1;
}

function label(name: string, y: number, text: string): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "bottom", position: { x: 8, y } }), label: { text, color: 7 } };
}

describe.skipIf(!toolchain.found || !haveMelon)("global variables and saving in a real ROM", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-state-"));
  const config = melonConfigPath();
  const configBackup = join(work, "melonDS.toml.backup");
  if (config) copyFileSync(config, configBackup);
  const restoreConfig = () => {
    if (config && existsSync(configBackup)) copyFileSync(configBackup, config);
  };
  afterAll(() => {
    restoreConfig();
    rmSync(work, { recursive: true, force: true });
  });
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function build(project: ProjectSnapshot, name: string): Promise<string> {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return rom;
  }

  it("a global set in one scene is what the next scene reads", async () => {
    const base = cubeProject();
    const cube: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "first" };
    const main: SceneNode = { ...base.scene, children: [...base.scene.children.filter((n) => n.name !== "Cube"), cube] };
    const second: SceneNode = createSceneNode({
      name: "Second",
      kind: "Node3D",
      children: [createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 5 } } }), { ...createSceneNode({ name: "Reader", kind: "Node3D" }), scriptId: "second" }, label("Shown", 8, "N{}")]
    });
    const project: ProjectSnapshot = {
      ...withSceneEntries({ ...base, scene: main }, [
        { id: DEFAULT_START_SCENE_ID, name: "Main", scene: main, isStart: true },
        { id: "two", name: "Second", scene: second, isStart: false }
      ]),
      scripts: [
        { id: "first", name: "First", source: 'global var score = 0\n\nfunc _ready():\n    score = 1234\n    change_scene("Second")\n' },
        { id: "second", name: "Second", source: "func _ready():\n    $Shown.value = score\n" }
      ]
    };
    const rom = await build(project, "scenes");
    const screens = captureBothScreens(rom, join(work, "scenes.png"));
    const width = textWidth(screens.bottom, 8, 16);
    console.info(`[state] two scenes: "N{}" is ${width} characters wide (N1234 is 5)`);
    expect(width).toBe(5);
  }, 240_000);

  it("saves the globals to the SD card and loads them back", async () => {
    if (!config) throw new Error("melonDS's settings file wasn't found");
    const base = cubeProject();
    const cube: SceneNode = { ...base.scene.children.find((n) => n.name === "Cube")!, scriptId: "save" };
    const main: SceneNode = { ...base.scene, children: [...base.scene.children.filter((n) => n.name !== "Cube"), cube, label("Score", 8, "N{}"), label("Status", 40, "?")] };
    const project: ProjectSnapshot = {
      ...base,
      scene: main,
      scripts: [
        {
          id: "save",
          name: "Save",
          source:
            'global var score = 0\n\nfunc _ready():\n    score = 4321\n    if save_game():\n        score = 0\n        if has_save() and load_game():\n            $Status.text = "LOADED"\n    else:\n        $Status.text = "NO"\n    $Score.value = score\n'
        }
      ]
    };
    const rom = await build(project, "save");
    // The card: a new 64 MB image file, which melonDS makes and formats when its DLDI setting names one that isn't there.
    const original = readFileSync(config, "utf8");
    const section = ["[DLDI]", "Enable = true", `ImagePath = ${JSON.stringify(join(work, "sd.img"))}`, "ImageSize = 64", "ReadOnly = false", "FolderSync = false", 'FolderPath = ""', "", ""].join("\n");
    const enabled = original.replace(/\[DLDI\][^[]*/, () => section);
    try {
      writeFileSync(config, enabled);
      const screens = captureBothScreens(rom, join(work, "save.png"), 8);
      const status = textWidth(screens.bottom, 40, 48);
      const score = textWidth(screens.bottom, 8, 16);
      console.info(`[state] save: status ${status} characters (LOADED is 6, NO is 2), score ${score} (N4321 is 5)`);
      // The script zeroes the score after saving, so only a load can bring back the 4321.
      expect(status).toBe(6);
      expect(score).toBe(5);
    } finally {
      restoreConfig();
    }
  }, 240_000);
});
