/**
 * A 3D scene described exactly as the DS runtime will draw it, already in the DS's own number
 * formats (see `fixed-point.ts`). This is plain data, the output of `translateScene3D` and the
 * input to `writeSceneDataC`; it contains no logic and refers to nothing in the editor.
 *
 * Matrices are 16 `f32` (20.12) values, column-major, as the geometry engine reads them.
 */

/** One mesh source's vertex data (a built-in primitive or an imported model), shared by every instance that uses it. */
export interface DsPrimitive {
  /** Which source this is, e.g. `primitive:cube` or `imported:<id>`; one table per distinct key. */
  key: string;
  /** A human name for the source (`cube`, or the model's name), for comments and messages. */
  label: string;
  /** u, v per vertex as texel-based `t16` values (see `toT16`); present only for a table built for a textured mesh. */
  texcoords?: number[];
  triangleCount: number;
  /** x, y, z per vertex, `v16` (4.12). Three vertices per triangle. */
  positions: number[];
  /** One packed 10-bit-per-axis normal per vertex. */
  normals: number[];
}

/** A texture's image, shared by every mesh that uses it. */
export interface DsTexture {
  key: string;
  label: string;
  width: number;
  height: number;
  /** The DS's size class for each side (8 is 0, 16 is 1, ... 1024 is 7). */
  sizeS: number;
  sizeT: number;
  /** 16-bit texels (red in the low five bits, opaque flag in bit 15), row 0 at the top. Already in the DS's format. */
  texels: number[];
}

/** A sound's samples, shared by every audio player that uses it. */
export interface DsSound {
  key: string;
  label: string;
  /** Samples per second, as recorded. */
  sampleRate: number;
  /**
   * Mono signed 16-bit samples, padded with one silent sample when the count is odd so the data is a whole number of
   * 4-byte words (what the DS's sound hardware reads).
   */
  samples: number[];
}

/** One AudioStreamPlayer's playback: which sound, and how. */
export interface DsAudioPlayer {
  /** Index into `DsScene3D.sounds`. */
  sound: number;
  /** 0..127. */
  volume: number;
  /** Playback rate in Hz: the sound's sample rate times the pitch, limited to what the hardware takes. */
  frequency: number;
  loop: boolean;
  /** Start when the game starts. A player without it is in the ROM but only a script can start it. */
  autoplay: boolean;
}

/**
 * One node of the scene, as the runtime keeps it (requirements/compiler/TASK.runtime-node-table-and-script-services.md). Every kept node is
 * listed, parents before their children. Scripts read and write the local values; the runtime composes the world transform of the
 * nodes marked `dynamic` every frame and uses the baked one for the rest.
 */
export interface DsNode {
  /** The node's name, for comments. */
  name: string;
  /** Index of its parent in `DsScene3D.nodes`, or -1 for the root. */
  parent: number;
  /** Local position, rotation (degrees) and scale as `f32` (20.12), as the Inspector shows them. */
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** Whether the node itself is visible (its ancestors decide whether it is drawn). */
  visible: boolean;
  /** A script can change this node's transform, so the runtime recomputes its world transform every frame. */
  dynamic: boolean;
  /** Baked world rotation + translation (16 `f32`) and cumulative scale, as the compiler computed them. Initial values for every node. */
  world: number[];
  worldScale: [number, number, number];
  /** Index into `DsScene3D.audioPlayers` when this node is an audio player with a sound, otherwise -1. */
  audio: number;
  /** Index into `DsScene3D.colliders` when this node is a collision shape, otherwise -1. */
  collider: number;
  /** Index into `DsScene3D.animationPlayers` when this node is an AnimationPlayer with animations, otherwise -1. */
  animPlayer: number;
}

/** One keyframe: the time and the value (a vector's X/Y/Z; a bool or a number is in the first slot), in 20.12. */
export interface DsAnimationKey {
  time: number;
  value: [number, number, number];
}

export type DsAnimationProperty = "position" | "rotation" | "scale" | "visible" | "volume" | "pitch";

/** One track: a property of a node (an index into `DsScene3D.nodes`) and its keys (a run in `DsScene3D.animationKeys`). */
export interface DsAnimationTrack {
  property: DsAnimationProperty;
  node: number;
  keyStart: number;
  keyCount: number;
}

export interface DsAnimation {
  name: string;
  /** Seconds, in 20.12. */
  length: number;
  loop: boolean;
  /** A run in `DsScene3D.animationTracks`. */
  trackStart: number;
  trackCount: number;
}

export interface DsAnimationPlayer {
  /** A run in `DsScene3D.animations`. */
  animationStart: number;
  animationCount: number;
  /** Which of its animations starts with the game (an index within the player's run), or -1. */
  autoplay: number;
  /** The playback speed, in 20.12. */
  speed: number;
}

/**
 * A collision shape (a `CollisionShape3D`), placed by its node. `params` are `f32` (20.12): a box's half extents; a sphere's radius; a capsule's radius
 * and half the length of its straight part (its height less the two round ends, halved); a cylinder's radius and half its height.
 */
export interface DsCollider {
  shape: "box" | "sphere" | "capsule" | "cylinder";
  /** Bodies moved by `move_and_collide` are stopped by this shape. */
  solid: boolean;
  params: [number, number, number];
}

export interface DsMesh {
  /** Index into `DsScene3D.nodes`. */
  node: number;
  /** Index into `DsScene3D.primitives`. */
  primitive: number;
  /** 0 for no texture, otherwise 1 + an index into `DsScene3D.textures`. */
  texture: number;
  /** RGB15 diffuse color. */
  diffuse: number;
  /**
   * Baked world transform, rotation and translation only (16 `f32`, column-major). The runtime never composes
   * transforms. Scale is kept apart in `scale` because the DS must not scale normals along with positions.
   */
  world: number[];
  /** Per-axis scale as `f32` (20.12), applied to positions only. Negative on x for a mirrored mesh. */
  scale: [number, number, number];
}

/** The DS has only parallel (directional) lights. */
export interface DsLight {
  /** Index into `DsScene3D.nodes`. */
  node: number;
  /** RGB15. */
  color: number;
  /** The direction the light travels, in world space, as three `v10` values. */
  direction: [number, number, number];
}

export interface DsCamera {
  /** Index into `DsScene3D.nodes`. */
  node: number;
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
  textures: DsTexture[];
  sounds: DsSound[];
  audioPlayers: DsAudioPlayer[];
  colliders: DsCollider[];
  animationPlayers: DsAnimationPlayer[];
  animations: DsAnimation[];
  animationTracks: DsAnimationTrack[];
  animationKeys: DsAnimationKey[];
  /** Every kept node, parents first. Meshes, the camera and lights refer to it. */
  nodes: DsNode[];
  /**
   * The generated `script_code.c`: the scripts' functions and the table of script instances the runtime walks. Always present (with an empty
   * table when nothing has a script). See `script-codegen.ts`.
   */
  scriptCode: string;
}
