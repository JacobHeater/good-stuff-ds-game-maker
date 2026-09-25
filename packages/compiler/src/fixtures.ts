import {
  createProjectSnapshot,
  createSceneNode,
  createTextureFromRgba,
  encodeSamples,
  getAudioPlayer,
  parseObj,
  type AudioPlayerData,
  type ImportedSound,
  type ImportedTexture,
  type MeshPrimitive,
  type ProjectSnapshot,
  type SceneNode,
  type Vector3
} from "@goodstuff/core";

import { lookAtEulerXYZ } from "./matrix";

/**
 * Small, known 3D projects used by the compiler's tests and by ROM builds. They're the single set of
 * fixtures every layer reads (translation tests, build tests, emulator tests), so a scene is described
 * once. Built with the real scene-node factories, so they stay valid as the model evolves.
 */

const ORIGIN: Vector3 = { x: 0, y: 0, z: 0 };

function camera(name: string, eye: Vector3, target: Vector3 = ORIGIN): SceneNode {
  return createSceneNode({
    name,
    kind: "Camera3D",
    transform3D: { position: eye, rotation: lookAtEulerXYZ(eye, target) }
  });
}

/** A light that shines from `from` toward the origin. */
function sun(name: string, from: Vector3): SceneNode {
  // A directional light travels along its local -Z, so aim it from the origin toward -from.
  const travel = { x: -from.x, y: -from.y, z: -from.z };
  return createSceneNode({
    name,
    kind: "DirectionalLight3D",
    transform3D: { position: from, rotation: lookAtEulerXYZ(ORIGIN, travel) }
  });
}

function mesh(name: string, primitive: MeshPrimitive, transform: Parameters<typeof createSceneNode>[0]["transform3D"] = {}): SceneNode {
  return createSceneNode({ name, kind: "MeshInstance3D", mesh: primitive, transform3D: transform });
}

function project(name: string, children: SceneNode[]): ProjectSnapshot {
  return createProjectSnapshot({
    name,
    mode: "3D",
    scene: createSceneNode({ name: "Main", kind: "Node3D", children })
  });
}

/** One cube, one camera, one light: the smallest scene that proves the pipeline. */
export function cubeProject(): ProjectSnapshot {
  return project("Cube", [
    mesh("Cube", "cube", { rotation: { x: 0, y: 30, z: 0 } }),
    camera("Camera", { x: 2.5, y: 2, z: 3.5 }),
    sun("Sun", { x: -2, y: 4, z: 3 })
  ]);
}

/** One of each primitive, side by side, so each shape can be recognized in a ROM. */
export function primitivesProject(): ProjectSnapshot {
  return project("Primitives", [
    mesh("Cube", "cube", { position: { x: -2.2, y: 0.5, z: 0 } }),
    mesh("Sphere", "sphere", { position: { x: -0.7, y: 0.5, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 } }),
    mesh("Cylinder", "cylinder", { position: { x: 0.9, y: 0.5, z: 0 } }),
    mesh("Plane", "plane", { position: { x: 2.4, y: 0, z: 0 }, scale: { x: 1.4, y: 1, z: 1.4 } }),
    camera("Camera", { x: 0, y: 3, z: 6 }, { x: 0, y: 0.3, z: 0 }),
    sun("Sun", { x: -3, y: 5, z: 4 })
  ]);
}

/** A mesh under nested, transformed Node3D parents, plus a hidden branch that must not appear. */
export function nestedProject(): ProjectSnapshot {
  const grandchild = mesh("Grandchild", "cube", { position: { x: 1, y: 0, z: 0 } });
  const child = createSceneNode({
    name: "Arm",
    kind: "Node3D",
    transform3D: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 45 } },
    children: [grandchild]
  });
  const parent = createSceneNode({
    name: "Rig",
    kind: "Node3D",
    transform3D: { position: { x: -1, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
    children: [child]
  });
  const hidden = createSceneNode({
    name: "Hidden",
    kind: "Node3D",
    visible: false,
    children: [mesh("Ghost", "sphere")]
  });
  // A small marker outside the hierarchy gives the nested cube something fixed to be placed against.
  const marker = mesh("Marker", "sphere", { position: { x: 2, y: 0, z: 0 }, scale: { x: 0.6, y: 0.6, z: 0.6 } });
  return project("Nested", [
    parent,
    hidden,
    marker,
    camera("Camera", { x: 2, y: 6, z: 12 }, { x: 0, y: 2, z: -0.5 }),
    sun("Sun", { x: 2, y: 5, z: 3 })
  ]);
}

/** The cube fixture with every node on the bottom screen: the DS should draw its 3D there instead. */
export function bottomScreenProject(): ProjectSnapshot {
  const p = cubeProject();
  p.scene.screen = "bottom"; // a 3D project keeps which screen the 3D engine drives in its scene root's screen (core's screen-layout.ts)
  for (const node of p.scene.children) node.screen = "bottom";
  return p;
}

/**
 * A grid of cubes that fills the DS's per-frame triangle budget: 13 x 13 = 169 cubes, 2028 triangles of the
 * 2048 the hardware can draw. Every cube is visible, so this is the heaviest frame the compiler allows.
 */
export function fullBudgetProject(): ProjectSnapshot {
  const cubes: SceneNode[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      cubes.push(
        mesh(`Cube ${row}-${col}`, "cube", {
          position: { x: (col - 6) * 1.1, y: 0, z: (row - 6) * 1.1 },
          scale: { x: 0.7, y: 0.7, z: 0.7 },
          rotation: { x: 0, y: (row * 13 + col) * 7, z: 0 }
        })
      );
    }
  }
  return project("Full budget", [...cubes, camera("Camera", { x: 0, y: 11, z: 10 }, ORIGIN), sun("Sun", { x: -3, y: 6, z: 4 })]);
}

/**
 * A small imported model, asymmetric on purpose (a gable and a pitched roof), so a wrong orientation, a
 * flipped winding or a mirrored axis changes its silhouette. The same text is tests/prototypes/e2e/models/house.obj
 * (a test checks the two haven't drifted).
 */
export const HOUSE_OBJ = `# A small house: four walls, two gables and a pitched roof. 14 triangles once the quads are split.
# Hand-written for testing model import; faces wind counter-clockwise seen from outside.
mtllib house.mtl
o house
v -1 0 -0.8
v 1 0 -0.8
v 1 0 0.8
v -1 0 0.8
v -1 1 -0.8
v 1 1 -0.8
v 1 1 0.8
v -1 1 0.8
v 0 1.8 -0.8
v 0 1.8 0.8
usemtl walls
f 4 3 7 8
f 2 1 5 6
f 3 2 6 7
f 1 4 8 5
f 8 7 10
f 6 5 9
usemtl roof
f 7 6 9 10
f 5 8 10 9
`;

/** A mesh node that uses an imported model instead of a primitive. */
function importedInstance(name: string, importedMeshId: string, triangleCount: number, transform: Parameters<typeof createSceneNode>[0]["transform3D"] = {}): SceneNode {
  const node = createSceneNode({ name, kind: "MeshInstance3D", transform3D: transform });
  node.mesh = { importedMeshId, triangleCount };
  return node;
}

/**
 * Two instances of one imported model (one turned and smaller) beside a built-in cube, so the scene
 * has a shared table for the model and one for the cube.
 */
export function importedModelProject(): ProjectSnapshot {
  const parsed = parseObj(HOUSE_OBJ, { name: "house" });
  if (!parsed.ok) throw new Error(`The house fixture doesn't parse: ${parsed.errors.join(" ")}`);
  const model = { id: "model-house", ...parsed.mesh };
  const base = project("Imported", [
    importedInstance("House", model.id, 14, { position: { x: -1.6, y: 0, z: 0 }, rotation: { x: 0, y: 25, z: 0 } }),
    importedInstance("Small house", model.id, 14, { position: { x: 1.4, y: 0, z: 0.5 }, rotation: { x: 0, y: -35, z: 0 }, scale: { x: 0.7, y: 0.7, z: 0.7 } }),
    mesh("Cube", "cube", { position: { x: 3.2, y: 0.5, z: -0.5 }, scale: { x: 0.8, y: 0.8, z: 0.8 } }),
    camera("Camera", { x: 1, y: 3.2, z: 7 }, { x: 0.8, y: 0.8, z: 0 }),
    sun("Sun", { x: -3, y: 5, z: 4 })
  ]);
  return { ...base, meshes: [model] };
}

/**
 * A `size` x `size` picture in four colored quadrants: red top-left, green top-right, blue bottom-left, yellow
 * bottom-right. Any mirroring, flipping or channel mix-up moves a color to the wrong corner, which is what the
 * emulator test looks for.
 */
export function quadrantTexture(id = "quadrants", size = 16): ImportedTexture {
  const rgba = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const right = x >= half;
      const bottom = y >= half;
      const [r, g, b] = !bottom ? (right ? [0, 255, 0] : [255, 0, 0]) : right ? [255, 255, 0] : [0, 0, 255];
      rgba.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  const made = createTextureFromRgba(rgba, size, size, { name: "quadrants" });
  if (!made.ok) throw new Error(`The quadrant texture doesn't convert: ${made.errors.join(" ")}`);
  return { id, ...made.texture };
}

/** A mesh node with a texture. */
function texturedMesh(name: string, primitive: MeshPrimitive, textureId: string, transform: Parameters<typeof createSceneNode>[0]["transform3D"] = {}): SceneNode {
  const node = mesh(name, primitive, transform);
  node.mesh = { primitive, triangleCount: node.mesh!.triangleCount, textureId };
  return node;
}

/**
 * A textured plane and a textured cube, both face-on to the camera and sharing one quadrant picture, so the picture
 * has to appear upright on both. The camera is straight ahead at (0, 0, 6) so a pinhole calculation says where each
 * quadrant lands on screen (the emulator test does that).
 */
export const TEXTURED_PLANE_X = -1.6;
export const TEXTURED_CUBE_X = 1.6;
export const TEXTURED_CUBE_SCALE = 1.8;
export function texturedProject(): ProjectSnapshot {
  const texture = quadrantTexture();
  const base = project("Textured", [
    // A plane faces +Y; turning it 90 degrees about X makes it face the camera (+Z), picture upright.
    texturedMesh("Plane", "plane", texture.id, { position: { x: TEXTURED_PLANE_X, y: 0, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } }),
    texturedMesh("Cube", "cube", texture.id, { position: { x: TEXTURED_CUBE_X, y: 0, z: 0 }, scale: { x: TEXTURED_CUBE_SCALE, y: TEXTURED_CUBE_SCALE, z: TEXTURED_CUBE_SCALE } }),
    camera("Camera", { x: 0, y: 0, z: 6 }),
    sun("Sun", { x: -2, y: 3, z: 6 })
  ]);
  return { ...base, textures: [texture] };
}

/**
 * One of each primitive, all wearing the quadrant picture, tilted a little toward the camera so a sphere's poles, a
 * cylinder's side and cap, and a cube's top show. Used to look at how every primitive is mapped, and as an emulator
 * fixture (its silhouette is checked like the others).
 */
export function texturedPrimitivesProject(): ProjectSnapshot {
  const texture = quadrantTexture();
  const base = project("Textured shapes", [
    texturedMesh("Cube", "cube", texture.id, { position: { x: -2.4, y: 0, z: 0 }, rotation: { x: 25, y: -30, z: 0 } }),
    texturedMesh("Sphere", "sphere", texture.id, { position: { x: -0.8, y: 0, z: 0 }, rotation: { x: 25, y: 0, z: 0 }, scale: { x: 1.3, y: 1.3, z: 1.3 } }),
    texturedMesh("Cylinder", "cylinder", texture.id, { position: { x: 0.9, y: 0, z: 0 }, rotation: { x: 30, y: 20, z: 0 } }),
    texturedMesh("Plane", "plane", texture.id, { position: { x: 2.6, y: 0, z: 0 }, rotation: { x: 70, y: 0, z: 0 }, scale: { x: 1.4, y: 1.4, z: 1.4 } }),
    camera("Camera", { x: 0, y: 1.5, z: 6.5 }, { x: 0, y: 0, z: 0 }),
    sun("Sun", { x: -2, y: 3, z: 6 })
  ]);
  return { ...base, textures: [texture] };
}

/**
 * A plain grey plane facing the camera, lit by one directional light at a chosen angle to the plane's normal (0 = straight
 * on, 90 = edge on), or by none. The plane is one flat color, so its brightness on screen is exactly what the lighting
 * produces; the lighting tests read it from the emulator and from the editor's viewport and compare it with the DS's formula.
 */
export function lightProbeProject(
  incidenceDegrees: number | null,
  options: { scale?: Vector3; intensity?: number } = {}
): ProjectSnapshot {
  const scale = options.scale ?? { x: 3, y: 3, z: 3 };
  const children = [
    // A plane faces +Y; turning it 90 degrees about X makes it face the camera (+Z).
    mesh("Plane", "plane", { rotation: { x: 90, y: 0, z: 0 }, scale }),
    camera("Camera", { x: 0, y: 0, z: 4 })
  ];
  if (incidenceDegrees !== null) {
    // A light travels along its local -Z; turning it about Y by -angle makes it travel (sin a, 0, -cos a), so it meets the
    // plane's +Z normal at `a` degrees.
    const light = createSceneNode({ name: "Light", kind: "DirectionalLight3D", transform3D: { position: { x: 0, y: 0, z: 3 }, rotation: { x: 0, y: -incidenceDegrees, z: 0 } } });
    if (options.intensity !== undefined) light.light = { intensity: options.intensity };
    children.push(light);
  }
  return project("Light probe", children);
}

/** A sine tone as a project sound: mono 16-bit at `sampleRate`, `seconds` long, at `hz`. */
export function toneSound(
  id = "tone",
  options: { sampleRate?: number; seconds?: number; hz?: number; amplitude?: number } = {}
): ImportedSound {
  const { sampleRate = 16000, seconds = 1, hz = 440, amplitude = 0.5 } = options;
  const samples = new Int16Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * hz * i) / sampleRate));
  return { id, name: id, sampleRate, samples: encodeSamples(samples) };
}

/** A player on `soundId` with its settings; fields left out take the audio player's defaults. */
export function audioPlayerNode(name: string, settings: Partial<AudioPlayerData> = {}): SceneNode {
  const node = createSceneNode({ name, kind: "AudioStreamPlayer" });
  node.audio = { ...getAudioPlayer({ audio: settings }) };
  return node;
}

/**
 * A cube, a camera and audio players that use the given sounds: the smallest scene that plays sound. (Without a camera the
 * compiler refuses a scene; without a mesh the picture would be empty, which makes a capture of the emulator hard.)
 */
export function soundProbeProject(players: SceneNode[], sounds: ImportedSound[]): ProjectSnapshot {
  const probe = project("Sound probe", [mesh("Cube", "cube", { rotation: { x: 0, y: 30, z: 0 } }), camera("Camera", { x: 2.5, y: 2, z: 3.5 }), sun("Sun", { x: -2, y: 4, z: 3 }), ...players]);
  return { ...probe, sounds };
}

/**
 * The sound-probe scene (a cube, a camera, a light) with scripts. `scripts` are `{ name, source, attachTo }`, where `attachTo` names the
 * nodes that use the script (default: the cube). `extra` adds more nodes to the scene first, for scripts that refer to them.
 */
export function scriptedProject(
  scripts: Array<{ name?: string; source: string; attachTo?: string[] }>,
  extra: SceneNode[] = []
): ProjectSnapshot {
  const cube = mesh("Cube", "cube", { rotation: { x: 0, y: 30, z: 0 } });
  const nodes = [cube, camera("Camera", { x: 2.5, y: 2, z: 3.5 }), sun("Sun", { x: -2, y: 4, z: 3 }), ...extra];
  const built: ProjectSnapshot = { ...project("Scripted", nodes), scripts: [] };
  const byName = (name: string): SceneNode | undefined => {
    const find = (node: SceneNode): SceneNode | undefined => (node.name === name ? node : node.children.map(find).find(Boolean));
    return find(built.scene);
  };
  scripts.forEach((script, index) => {
    const id = `script-${index + 1}`;
    built.scripts!.push({ id, name: script.name ?? `Script${index + 1}`, source: script.source });
    for (const name of script.attachTo ?? ["Cube"]) {
      const node = byName(name);
      if (!node) throw new Error(`no node named ${name} to attach a script to`);
      node.scriptId = id;
    }
  });
  return built;
}
