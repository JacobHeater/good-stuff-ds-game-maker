import {
  createProjectSnapshot,
  createSceneNode,
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
