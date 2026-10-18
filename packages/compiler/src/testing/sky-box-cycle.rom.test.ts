import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, type ProjectSnapshot } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { captureRom } from "./emulator-capture";

function baselineProject(): ProjectSnapshot {
  const camera = createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 10 }, rotation: { x: 0, y: 0, z: 0 } } });
  const cube = createSceneNode({ name: "Cube", kind: "MeshInstance3D", mesh: "cube", transform3D: { position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 3 } } });
  const sun = createSceneNode({ name: "Sun", kind: "DirectionalLight3D", transform3D: { position: { x: 0, y: 5, z: 5 }, rotation: { x: -45, y: -30, z: 0 } } });
  return createProjectSnapshot({ name: "Baseline", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [camera, cube, sun] }) });
}

/**
 * A day/night cycle, built the way `SkyBoxData.current`'s own doc comment (requirements/scene-designer's own
 * STORY.sky-box.md) says to: two SkyBox3D nodes, each its own colors, switched by a script toggling each one's own
 * ordinary `visible` -- no dedicated runtime switch. Proves the whole point on real hardware: a script flipping
 * visibility mid-run actually changes which gradient the runtime draws, the same frame it runs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const CAPTURE_SCRIPT = resolve(HERE, "..", "..", "..", "..", "tools", "ds-toolchain", "melonds-input.ps1");

function project(): ProjectSnapshot {
  const camera = createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 2, z: 10 }, rotation: { x: 0, y: 0, z: 0 } } });
  const day = createSceneNode({ name: "Day", kind: "SkyBox3D" });
  day.skyBox = { topColor: "#ff0000", horizonColor: "#ff0000" };
  const night = createSceneNode({ name: "Night", kind: "SkyBox3D" });
  night.visible = false;
  night.skyBox = { topColor: "#0000ff", horizonColor: "#0000ff" };
  camera.scriptId = "cycle";
  const built = createProjectSnapshot({ name: "DayNight", mode: "3D", scene: createSceneNode({ name: "Main", kind: "Node3D", children: [camera, day, night] }) });
  return {
    ...built,
    scripts: [{ id: "cycle", name: "Cycle", source: 'func _process(delta):\n    if Input.is_button_down("a"):\n        $Day.visible = false\n        $Night.visible = true\n' }]
  };
}

describe.skipIf(!toolchain.found)("a day/night cycle built from two SkyBox3D nodes, toggled by a script", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-skybox-cycle-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  function sampleCenter(pngPath: string, rect: { left: number; top: number; width: number; height: number }) {
    const png = PNG.sync.read(readFileSync(pngPath));
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const i = (cy * png.width + cx) * 4;
    return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
  }

  const isRedder = (c: { r: number; g: number; b: number }): boolean => c.r > c.b;
  const isBluer = (c: { r: number; g: number; b: number }): boolean => c.b > c.r;

  it("draws the Day sky box at first, and the Night one once the script's own visibility toggle runs", async () => {
    // Both sky boxes fill the whole screen, so captureRom's own backdrop-color auto-detect (STORY.sky-box.md's own
    // note on this) can't find the screen in either capture -- the screen rect comes from a plain, sky-box-free
    // baseline ROM instead (same camera framing, same window/emulator placement).
    const baselineRom = join(work, "baseline.nds");
    const baselineBuilt = await compileProject(baselineProject(), baselineRom, builder);
    if (!baselineBuilt.ok) throw new Error(`Build failed: ${baselineBuilt.message}`);
    const baseline = captureRom(baselineRom, join(work, "baseline.png"), 3);
    const rect = baseline.screen;

    const rom = join(work, "cycle.nds");
    const built = await compileProject(project(), rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);

    const idlePng = join(work, "idle.png");
    const idle = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Rom", rom, "-Out", idlePng, "-HoldSeconds", "1.5"], { encoding: "utf-8", timeout: 60_000 });
    if (idle.status !== 0) throw new Error(`Capturing failed:\n${idle.stdout}\n${idle.stderr}`);
    const beforeToggle = sampleCenter(idlePng, rect);
    expect(isRedder(beforeToggle), `expected the Day sky box (red), got ${JSON.stringify(beforeToggle)}`).toBe(true);

    const heldPng = join(work, "held.png");
    const held = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Rom", rom, "-Out", heldPng, "-Hold", "a", "-HoldSeconds", "1.5"], { encoding: "utf-8", timeout: 60_000 });
    if (held.status !== 0) throw new Error(`Capturing failed:\n${held.stdout}\n${held.stderr}`);
    const afterToggle = sampleCenter(heldPng, rect);
    expect(isBluer(afterToggle), `expected the Night sky box (blue) once the script toggled visibility, got ${JSON.stringify(afterToggle)}`).toBe(true);
  }, 120_000);
});
