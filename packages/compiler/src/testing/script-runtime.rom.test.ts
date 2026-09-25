import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSceneNode, findSceneNode, type SceneNode } from "@goodstuff/core";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "../build/node-adapters";
import { RomBuilder } from "../build/rom-builder";
import { compileProject } from "../compile-project";
import { lightProbeProject, scriptedProject } from "../fixtures";
import { captureRom } from "./emulator-capture";
import { coveredPixels, referenceSilhouette, silhouetteIoU } from "./reference-render";

/**
 * Scripts that move, rotate, scale and show nodes, in a real ROM on the emulator, against an independent picture: each scenario's ROM is captured
 * and compared with a three.js render of the *equivalent static project* (the same values, set in the scene instead of by a script). If the two agree,
 * the runtime's per-frame transforms put the nodes where the editor would. Each scenario also checks that the script really changed something
 * (its picture is not the unscripted scene's).
 *
 * Requirements: requirements/compiler/TASK.runtime-node-table-and-script-services.md, scripting/STORY.write-and-run-scripts.md.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const toolchain = await new NodeToolchainLocator().locate();
const haveMelon = existsSync(process.env.LOCALAPPDATA ?? "");
const IOU_MINIMUM = 0.85;

type Project = ReturnType<typeof scriptedProject>;

const box = (name: string, x: number, y = 0, z = 0, size = 1): SceneNode =>
  createSceneNode({ name, kind: "MeshInstance3D", mesh: "cube", transform3D: { position: { x, y, z }, scale: { x: size, y: size, z: size } } });
const hidden = (node: SceneNode): SceneNode => {
  node.visible = false;
  return node;
};
const nodeOf = (project: Project, name: string): SceneNode => {
  const node = findSceneNode(project.scene, name) ?? [...flatten(project.scene)].find((n) => n.name === name);
  if (!node) throw new Error(`no node ${name}`);
  return node;
};
function* flatten(node: SceneNode): Generator<SceneNode> {
  yield node;
  for (const child of node.children) yield* flatten(child);
}
const set = (project: Project, name: string, patch: { position?: Partial<Record<"x" | "y" | "z", number>>; rotation?: Partial<Record<"x" | "y" | "z", number>>; scale?: Partial<Record<"x" | "y" | "z", number>>; visible?: boolean }): void => {
  const node = nodeOf(project, name);
  if (patch.position) Object.assign(node.transform3D!.position, patch.position);
  if (patch.rotation) Object.assign(node.transform3D!.rotation, patch.rotation);
  if (patch.scale) Object.assign(node.transform3D!.scale, patch.scale);
  if (patch.visible !== undefined) node.visible = patch.visible;
};

interface Scenario {
  name: string;
  source: string;
  attachTo?: string[];
  /** Extra nodes for the scene; a fresh set each time it is called (the scripted and the equivalent project each get their own). */
  extras?: () => SceneNode[];
  /** Applies what the script does to the equivalent static project. */
  equivalent: (project: Project) => void;
  /** The scripted picture must differ from the unscripted one by at least this much (1 - IoU). */
  minChange?: number;
}

const scenarios: Scenario[] = [
  {
    name: "position: a script sets a mesh's position",
    source: "func _ready():\n    position.x = 1.2\n    position.y = 0.4\n",
    equivalent: (p) => set(p, "Cube", { position: { x: 1.2, y: 0.4 } })
  },
  {
    name: "rotation: a script sets a mesh's rotation (XYZ Euler, degrees)",
    source: "func _ready():\n    rotation.x = 20.0\n    rotation.y = 75.0\n",
    equivalent: (p) => set(p, "Cube", { rotation: { x: 20, y: 75 } })
  },
  {
    name: "scale: a script sets a mesh's scale",
    source: "func _ready():\n    scale.x = 1.8\n    scale.y = 0.6\n",
    equivalent: (p) => set(p, "Cube", { scale: { x: 1.8, y: 0.6 } })
  },
  {
    name: "_process: a script moves a mesh a little every frame, until it gets there",
    source: "func _process(delta):\n    if position.x < 1.0:\n        position.x += 0.05\n",
    equivalent: (p) => set(p, "Cube", { position: { x: 4100 / 4096 } })
  },
  {
    name: "children follow their parent: a script rotates and scales a group",
    source: "func _ready():\n    rotation.y = 60.0\n    scale.x = 1.5\n    scale.y = 1.5\n    scale.z = 1.5\n",
    attachTo: ["Group"],
    extras: () => [createSceneNode({ name: "Group", kind: "Node3D", transform3D: { position: { x: 0, y: 0.6, z: -1.5 } }, children: [box("Box", 1.4, 0, 0, 0.6)] })],
    equivalent: (p) => set(p, "Group", { rotation: { y: 60 }, scale: { x: 1.5, y: 1.5, z: 1.5 } }),
    minChange: 0.1
  },
  {
    name: "a script on another node moves a whole branch, and its children with it",
    source: "func _ready():\n    $Group.position.x = -2.0\n    $Group.rotation.z = 35.0\n",
    extras: () => [createSceneNode({ name: "Group", kind: "Node3D", transform3D: { position: { x: 0, y: 0, z: 0 } }, children: [box("Box", 0, 1.3, 0, 0.6), box("Box2", 0, -1.3, 0, 0.6)] })],
    equivalent: (p) => set(p, "Group", { position: { x: -2 }, rotation: { z: 35 } })
  },
  {
    name: "visibility: a script shows a hidden node",
    source: "func _ready():\n    $Ghost.visible = true\n",
    extras: () => [hidden(box("Ghost", -1.6, 0, 0))],
    equivalent: (p) => set(p, "Ghost", { visible: true })
  },
  {
    name: "visibility: a script hides its own node, leaving the rest",
    source: "func _ready():\n    visible = false\n",
    extras: () => [box("Box", 1.6, 0, 0, 0.7)],
    equivalent: (p) => set(p, "Cube", { visible: false })
  },
  {
    name: "visibility: hiding a parent hides its children",
    source: "func _ready():\n    $Group.visible = false\n",
    extras: () => [createSceneNode({ name: "Group", kind: "Node3D", children: [box("Box", 1.6, 0, 0, 0.7), box("Box2", -1.6, 0, 0, 0.7)] })],
    equivalent: (p) => set(p, "Group", { visible: false })
  },
  {
    name: "the camera: a script moves it",
    source: "func _ready():\n    position.x = 0.5\n    position.y = 3.0\n",
    attachTo: ["Camera"],
    equivalent: (p) => set(p, "Camera", { position: { x: 0.5, y: 3 } })
  },
  {
    name: "the camera: a script turns it",
    source: "func _ready():\n    rotation.y += 9.0\n    rotation.x -= 4.0\n",
    attachTo: ["Camera"],
    equivalent: (p) => {
      const camera = nodeOf(p, "Camera").transform3D!.rotation;
      set(p, "Camera", { rotation: { y: camera.y + 9, x: camera.x - 4 } });
    }
  },
  {
    name: "one script on two nodes moves each from where it is",
    source: "func _ready():\n    position.y += 0.7\n    position.x *= 2.0\n",
    attachTo: ["Cube", "Second"],
    extras: () => [box("Second", -1.5, 0, 0, 0.7)],
    equivalent: (p) => {
      set(p, "Cube", { position: { y: 0.7, x: 0 } });
      set(p, "Second", { position: { y: 0.7, x: -3 } });
    }
  }
];

describe.skipIf(!toolchain.found || !haveMelon)("scripts move, turn, scale and show nodes in a real ROM, as the editor would", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-script-rom-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const builder = new RomBuilder({ locator: new NodeToolchainLocator(), runner: new NodeBuildRunner(), fs: new NodeBuildFileSystem(), runtimeDir: resolve(HERE, "..", "..", "runtime") });

  async function shoot(name: string, project: Project) {
    const rom = join(work, `${name}.nds`);
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    return captureRom(rom, join(work, `${name}.png`), 6);
  }

  scenarios.forEach((scenario, index) => {
    it(scenario.name, async () => {
      const scripted = scriptedProject([{ name: "Test", source: scenario.source, attachTo: scenario.attachTo }], scenario.extras?.() ?? []);
      const equivalent = scriptedProject([], scenario.extras?.() ?? []);
      scenario.equivalent(equivalent);
      const shot = await shoot(`scenario-${index}`, scripted);
      const reference = referenceSilhouette(equivalent);
      const baseline = referenceSilhouette(scriptedProject([], scenario.extras?.() ?? []));
      const agreement = silhouetteIoU(shot.silhouette, reference);
      const unchanged = silhouetteIoU(shot.silhouette, baseline);
      console.info(`[script-rom] ${scenario.name}: matches the equivalent scene ${agreement.toFixed(3)}, matches the unscripted scene ${unchanged.toFixed(3)}`);
      expect(agreement, "the ROM matches the equivalent static scene").toBeGreaterThanOrEqual(IOU_MINIMUM);
      // The script must have done something the picture shows.
      expect(1 - unchanged, "the script changed the picture").toBeGreaterThanOrEqual(scenario.minChange ?? 0.08);
    }, 120_000);
  });

  it("a script rotating a directional light changes the shading, as the DS lighting formula says", async () => {
    // A flat plane facing the camera, lit straight on (247) -> the script turns the light to 60 degrees off (158).
    const project = lightProbeProject(0);
    const light = [...flatten(project.scene)].find((n) => n.kind === "DirectionalLight3D")!;
    project.scripts = [{ id: "s1", name: "Turn", source: "func _ready():\n    rotation.y = -60.0\n" }];
    light.scriptId = "s1";
    const rom = join(work, "light.nds");
    const built = await compileProject(project, rom, builder);
    if (!built.ok) throw new Error(`Build failed: ${built.message}`);
    const shot = captureRom(rom, join(work, "light.png"), 6);
    const png = PNG.sync.read(readFileSync(shot.pngPath));
    const cx = Math.round(shot.screen.left + shot.screen.width / 2);
    const cy = Math.round(shot.screen.top + shot.screen.height / 2);
    let sum = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) sum += png.data[((cy + dy) * png.width + cx + dx) * 4];
    const brightness = sum / 121;
    console.info(`[script-rom] light turned to 60 degrees: brightness ${brightness.toFixed(0)} (the formula says 158; unturned reads 247)`);
    expect(Math.abs(brightness - 158)).toBeLessThanOrEqual(14);
  }, 120_000);

  it("a scene of many nodes with scripts still runs at full speed", async () => {
    // 60 moving cubes (720 triangles) with a script each: the title melonDS shows is [presented frames / 60].
    const extras = Array.from({ length: 60 }, (_, i) => box(`Box${i}`, ((i % 10) - 4.5) * 0.9, (Math.floor(i / 10) - 2.5) * 0.9, -2, 0.5));
    const project = scriptedProject([{ name: "Spin", source: "func _process(delta):\n    rotation.y += 90.0 * delta\n    position.z += 0.0\n", attachTo: extras.map((e) => e.name) }], extras);
    const shot = await shoot("busy", project);
    expect(shot.title).toMatch(/\[6[0-1]\/60\]/);
    expect(coveredPixels(shot.silhouette)).toBeGreaterThan(2000);
  }, 120_000);
});
