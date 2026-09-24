import type { MeshPrimitive } from "@goodstuff/core";

/**
 * A 3D scene described exactly as the DS runtime will draw it, already in the DS's own number
 * formats (see `fixed-point.ts`). This is plain data, the output of `translateScene3D` and the
 * input to `writeSceneDataC`; it contains no logic and refers to nothing in the editor.
 *
 * Matrices are 16 `f32` (20.12) values, column-major, as the geometry engine reads them.
 */

/** One primitive's vertex data, shared by every mesh instance that uses it. */
export interface DsPrimitive {
  primitive: MeshPrimitive;
  triangleCount: number;
  /** x, y, z per vertex, `v16` (4.12). Three vertices per triangle. */
  positions: number[];
  /** One packed 10-bit-per-axis normal per vertex. */
  normals: number[];
}

export interface DsMesh {
  /** Index into `DsScene3D.primitives`. */
  primitive: number;
  /** RGB15 diffuse color. */
  diffuse: number;
  /** Baked world transform. The runtime never composes transforms. */
  world: number[];
}

/** The DS has only parallel (directional) lights. */
export interface DsLight {
  /** RGB15. */
  color: number;
  /** The direction the light travels, in world space, as three `v10` values. */
  direction: [number, number, number];
}

export interface DsCamera {
  fovDegrees: number;
  nearPlane: number;
  farPlane: number;
  /** World-to-camera transform. */
  view: number[];
}

export interface DsScene3D {
  /** Which physical screen the 3D engine drives. The DS can only do 3D on one. */
  screen: "top" | "bottom";
  /** Presentation rate. */
  fps: 30 | 60;
  camera: DsCamera;
  /** At most `MAX_DS_LIGHTS`. */
  lights: DsLight[];
  meshes: DsMesh[];
  primitives: DsPrimitive[];
}
