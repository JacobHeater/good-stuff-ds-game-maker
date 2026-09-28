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
  /** Index into `DsScene3D.touchAreas` when this node is a TouchArea2D or TouchArea3D, otherwise -1. */
  touch: number;
}

/**
 * A touch area (a `TouchArea2D` or `TouchArea3D`), placed by its node. A "rect" is a rectangle on the touch screen in screen pixels (`rect` is left, top,
 * width, height); a "box" or "sphere" is a volume in the 3D scene, placed and scaled by its node, and `params` are `f32` (20.12): a box's half extents or a
 * sphere's radius in the first slot.
 */
export interface DsTouchArea {
  /** Index into `DsScene3D.nodes`. */
  node: number;
  shape: "rect" | "box" | "sphere";
  rect: [number, number, number, number];
  params: [number, number, number];
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
 * and half the length of its straight part (its height less the two round ends, halved); a cylinder's radius and half its height; a convex hull's
 * bounding radius in its own local space (params[1] and params[2] unused) — the runtime bounds it exactly like a sphere of that radius before it
 * ever looks at `hull`, since it's cheap and always big enough.
 */
export interface DsCollider {
  shape: "box" | "sphere" | "capsule" | "cylinder" | "convexHull";
  /** Bodies moved by `move_and_collide` are stopped by this shape. */
  solid: boolean;
  params: [number, number, number];
  /** `shape: "convexHull"` only: the hull's own points (f32, 20.12), in the collider node's local space — what its parent mesh's real geometry approximates to. */
  hull?: readonly [number, number, number][];
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
  /**
   * A model with several poses that has frame animations (requirements/scene-designer/STORY.animated-3d-models.md): its poses' vertex tables are `frameCount` entries of `DsScene3D.meshFrames`
   * from `frameStart` (each a primitive index; the first is `primitive`), `animation` is the animation (an index into `meshAnimations`) that plays at the start or -1, and its own
   * animations are `animationCount` entries from `animationFirst`. A mesh that isn't animated has all of these 0 (and -1 for `animation`).
   */
  frameStart: number;
  frameCount: number;
  animation: number;
  animationFirst: number;
  animationCount: number;
  /** This mesh ignores the scene's lights and always shows `diffuse` at full brightness. */
  unlit: boolean;
  /** Which side(s) of the mesh's triangles are drawn (see core's `MeshCullMode`). */
  cull: "none" | "back" | "front";
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
  /** tan(fovDegrees / 2): what turns a touched point on the screen into a ray through the scene (touch areas in 3D). */
  tanHalfFov: number;
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
  touchAreas: DsTouchArea[];
  /** The primitive of each pose of each animated mesh, meshes' runs one after another (see `DsMesh.frameStart`). */
  meshFrames: number[];
  /** Every frame animation of every animated mesh; a mesh's own are a run of it. `frames` are poses of the mesh (0 is its first). */
  meshAnimations: DsSpriteAnimation[];
  /**
   * The sprites on the project's 2D screen (the sub engine; the 3D engine is the main one). Empty when there are none, in which case the runtime keeps all four
   * VRAM banks for textures; with sprites, one bank holds their tiles and textures get three (384 KB).
   */
  sprites2D: DsScreen2D;
  /** The project's global variables, the same in every scene (they keep their values when the scene changes and are what the save file holds). */
  globals: DsGlobal[];
  /** Every kept node, parents first. Meshes, the camera and lights refer to it. */
  nodes: DsNode[];
  /**
   * The generated `script_code.c`: the scripts' functions and the table of script instances the runtime walks. Always present (with an empty
   * table when nothing has a script). See `script-codegen.ts`.
   */
  scriptCode: string;
}

/**
 * One sprite image as the DS's sprite engine holds it (256 colors, 8 bits a pixel): the pixels are already in the order the
 * hardware reads them (8 x 8 tiles left to right, top to bottom, each tile's 64 pixels row by row), so the runtime copies them
 * into sprite memory as they are. Shared by every sprite on the screen that draws it.
 */
export interface DsSpriteImage {
  key: string;
  label: string;
  /** One of the DS's sprite sizes (`SPRITE_SIZES` in core). */
  width: number;
  height: number;
  /** All 256 palette entries as RGB15; entry 0 is the transparent color (never drawn) and unused entries are 0. */
  palette: number[];
  /** `frames` frames of `width * height` bytes each, one after the other, each in tile order. */
  tiles: number[];
  /** How many frames the image has: 1 for a picture, more for a sprite sheet (`width` and `height` are one frame's size). All of them share the palette. */
  frames: number;
}

/**
 * One animation of an AnimatedSprite2D, ready for the runtime: the frames (numbers in the sheet), how far it goes through them each game frame and whether it starts over
 * at the end. `step` is animation frames per game frame in 20.12 (a speed of 12 frames a second in a 30 fps game is 0.4 = 1638): the runtime adds it up and moves on a
 * frame each time it passes 1.
 */
export interface DsSpriteAnimation {
  frames: number[];
  step: number;
  loop: boolean;
}

/**
 * One `Sprite2D` on a screen: which image and where its top-left corner sits, in screen pixels. In a 3D project (whose scripts can move, turn, scale and hide the
 * sprite) it also says which node holds its live state, whether the runtime must follow that node every frame, and which of the engine's rotation matrices it uses.
 */
export interface DsSprite {
  /** The node's name, for comments. */
  name: string;
  /** Index into `DsScreen2D.images`. */
  image: number;
  /** The corner of the sprite as it starts. For a sprite with a rotation matrix it is the corner of the doubled box the hardware draws it in, centered on the picture. */
  x: number;
  y: number;
  /** Index into `DsScene3D.nodes` (the node's position, rotation, scale and visibility are the sprite's), or -1 when no script can reach the sprite. Only in a 3D project. */
  node?: number;
  /** A script can change the sprite, so the runtime reads its node every frame and updates the sprite. Only in a 3D project. */
  dynamic?: boolean;
  /** The rotation matrix (0..31) this sprite is drawn with, or -1 for none: a sprite that starts rotated or scaled, or that a script can change. Only in a 3D project. */
  affine?: number;
  /** The rotation (degrees, clockwise) and scale the sprite starts with, as `f32` (20.12). Only in a 3D project. */
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /**
   * An AnimatedSprite2D: which of the screen's `animations` plays when the scene starts (-1: none does, and the sprite shows frame 0), and the range of that table this
   * sprite's own animations fill (`animationFirst` for `animationCount` entries, in the order a script's `play("name")` counts them). Sprites that aren't animated have -1, 0, 0.
   */
  animation: number;
  animationFirst: number;
  animationCount: number;
}

/**
 * One `Label` on a screen: text on the 8 x 8 grid (`column` 0..31, `row` 0..23), in one of the console's eight colors. `text` is plain ASCII (the compiler replaces anything the DS's
 * font hasn't got) and may hold `{}` where the label's value goes. In a 3D project `node` is the label's place in the node table (its visibility is the node's), or -1.
 */
/** One of the project's global variables (`global var`), as the runtime keeps it: one 32-bit number (a float in 20.12) with the value the game starts with. */
export interface DsGlobal {
  name: string;
  type: "int" | "float" | "bool";
  value: number;
}

export interface DsLabel {
  name: string;
  column: number;
  row: number;
  color: number;
  text: string;
  node?: number;
  /** Whether it shows when the scene starts (a script can change it). Only in a 3D project. */
  visible?: boolean;
}

/** What one 2D engine draws. */
export interface DsScreen2D {
  images: DsSpriteImage[];
  /** The screen's text, in tree order (later labels are drawn over earlier ones). */
  labels: DsLabel[];
  /** Every animation of every AnimatedSprite2D on the screen; a sprite's own are a run of it (`DsSprite.animationFirst`). */
  animations: DsSpriteAnimation[];
  /** In hardware order: the first sprite is drawn over all the others. */
  sprites: DsSprite[];
}

/**
 * A 2D project described as the DS's two 2D engines will show it. Plain data, the output of `translateScene2D` and the input
 * to `writeScene2DDataC`. The top screen is the main engine and the bottom screen the sub engine.
 */
export interface DsScene2D {
  fps: 30 | 60;
  top: DsScreen2D;
  bottom: DsScreen2D;
}
