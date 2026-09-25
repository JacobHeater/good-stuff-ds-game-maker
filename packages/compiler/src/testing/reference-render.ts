import { resolveMeshGeometry, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { Group, Object3D, PerspectiveCamera, Vector3 } from "three";

import { DEFAULTS } from "../translate-scene-3d";

/**
 * Test support: an independent picture of what a project should look like on the DS, made by three.js
 * the way the editor's viewport builds a scene (`Viewport3D`): a hierarchy of groups, each with its node's
 * position, XYZ Euler rotation (degrees) and scale, hidden nodes hiding their subtree. It shares nothing
 * with the compiler's own matrix code except the geometry definition, so agreement between this and a ROM
 * captured from an emulator is real evidence that the compiler placed things correctly.
 *
 * It renders a **silhouette** (which pixels a mesh covers), not colors or lighting: the DS's lighting is
 * coarser than three.js's, and every mesh is the same grey.
 */

export const DS_WIDTH = 256;
export const DS_HEIGHT = 192;

export interface Silhouette {
  width: number;
  height: number;
  /** 1 where a mesh covers the pixel, 0 elsewhere. Row-major, top row first. */
  mask: Uint8Array;
}

const DEG = Math.PI / 180;

function buildThreeScene(root: SceneNode): { scene: Group; meshes: Array<{ object: Object3D; node: SceneNode }>; camera: PerspectiveCamera | null } {
  const scene = new Group();
  const meshes: Array<{ object: Object3D; node: SceneNode }> = [];
  let camera: PerspectiveCamera | null = null;

  const add = (node: SceneNode, parent: Object3D): void => {
    if (!node.visible) return;
    const group = new Group();
    if (node.transform3D) {
      const t = node.transform3D;
      group.position.set(t.position.x, t.position.y, t.position.z);
      group.rotation.set(t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG, "XYZ");
      // Cameras aren't scaled by the compiler (a scaled camera would distort the projection); match that.
      if (node.kind !== "Camera3D") group.scale.set(t.scale.x, t.scale.y, t.scale.z);
    }
    parent.add(group);
    if (node.kind === "MeshInstance3D" && node.mesh) meshes.push({ object: group, node });
    if (node.kind === "Camera3D" && !camera) {
      camera = new PerspectiveCamera(DEFAULTS.fovDegrees, DS_WIDTH / DS_HEIGHT, DEFAULTS.nearPlane, DEFAULTS.farPlane);
      group.add(camera);
    }
    for (const child of node.children) add(child, group);
  };
  add(root, scene);
  scene.updateMatrixWorld(true);
  return { scene, meshes, camera };
}

/** The silhouette the project's meshes should cover on a 256x192 screen, seen from its first camera. */
export function referenceSilhouette(project: ProjectSnapshot): Silhouette {
  const { meshes, camera } = buildThreeScene(project.scene);
  if (!camera) throw new Error("The project has no camera.");
  const cam: PerspectiveCamera = camera;
  cam.updateMatrixWorld(true);

  const mask = new Uint8Array(DS_WIDTH * DS_HEIGHT);
  const v = new Vector3();

  for (const { object, node } of meshes) {
    const geometry = resolveMeshGeometry(node.mesh!, project.meshes)!;
    const screen: Array<[number, number]> = [];
    for (let i = 0; i < geometry.positions.length; i += 3) {
      v.set(geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]).applyMatrix4(object.matrixWorld);
      const inCamera = v.clone().applyMatrix4(cam.matrixWorldInverse);
      if (inCamera.z > -DEFAULTS.nearPlane) throw new Error(`"${node.name}" is behind or too near the camera; frame the fixture.`);
      v.project(cam);
      screen.push([(v.x * 0.5 + 0.5) * DS_WIDTH, (1 - (v.y * 0.5 + 0.5)) * DS_HEIGHT]);
    }
    for (let t = 0; t < screen.length; t += 3) fillTriangle(mask, screen[t], screen[t + 1], screen[t + 2]);
  }
  return { width: DS_WIDTH, height: DS_HEIGHT, mask };
}

/** Fills the pixels whose centers fall inside a triangle (either winding). */
function fillTriangle(mask: Uint8Array, a: [number, number], b: [number, number], c: [number, number]): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(DS_WIDTH - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(DS_HEIGHT - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * DS_WIDTH + x] = 1;
    }
  }
}

/** Intersection over union of two same-sized silhouettes: 1 is identical, 0 is disjoint. */
export function silhouetteIoU(a: Silhouette, b: Silhouette): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Silhouettes differ in size.");
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.mask.length; i++) {
    if (a.mask[i] && b.mask[i]) inter++;
    if (a.mask[i] || b.mask[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

export function coveredPixels(s: Silhouette): number {
  return s.mask.reduce((n, v) => n + v, 0);
}
