import { DS_HARDWARE_PROFILE } from "./hardware";
import type { ImportedMesh } from "./imported-mesh";
import { getSoundByteSize, type ImportedSound } from "./imported-sound";
import { getTextureByteSize, type ImportedTexture } from "./imported-texture";
import { resolveMeshGeometry } from "./mesh-geometry";
import { flattenSceneTree, OAM_CONSUMING_KINDS, type SceneNode } from "./scene-node";
import type { ScreenId } from "./index";

export interface ScreenBudget {
  screen: ScreenId;
  spritesUsed: number;
  spritesLimit: number;
}

export interface SceneBudgetReport {
  perScreen: ScreenBudget[];
  totalNodes: number;
  audioPlayersUsed: number;
  audioChannelsLimit: number;
  trianglesUsed: number;
  trianglesLimit: number;
  /** Bytes of the DS's texture memory taken by the distinct textures the scene's meshes use. */
  textureBytesUsed: number;
  textureBytesLimit: number;
  /** Bytes of main RAM taken by the samples of the distinct sounds the scene's audio players use. */
  soundBytesUsed: number;
  soundBytesLimit: number;
}

/**
 * Computes how much of the DS's fixed hardware budget a scene tree consumes.
 * Mirrors what Godot's debugger/profiler would show, but against a static
 * hardware ceiling instead of a live frame profile.
 */
export function computeSceneBudget(
  root: SceneNode,
  importedMeshes?: readonly ImportedMesh[],
  textures?: readonly ImportedTexture[],
  sounds?: readonly ImportedSound[]
): SceneBudgetReport {
  const nodes = flattenSceneTree(root);

  const perScreen: ScreenBudget[] = (["top", "bottom"] as ScreenId[]).map((screen) => ({
    screen,
    spritesUsed: nodes.filter((node) => node.screen === screen && OAM_CONSUMING_KINDS.has(node.kind)).length,
    spritesLimit: DS_HARDWARE_PROFILE.graphics2D.oamSpritesPerScreen
  }));

  // Recomputed from the geometry, not read from the node's stored count (which may predate a re-tessellation).
  // A mesh naming a model the project lacks counts nothing here; the compiler reports it as an error.
  const trianglesUsed = nodes.reduce(
    (sum, node) => sum + (node.mesh ? (resolveMeshGeometry(node.mesh, importedMeshes)?.triangleCount ?? 0) : 0),
    0
  );

  // A texture used by several meshes is uploaded once, so it's counted once. A mesh naming a texture the project
  // lacks counts nothing here; the compiler reports it as an error.
  const usedTextureIds = new Set(nodes.flatMap((node) => (node.mesh?.textureId ? [node.mesh.textureId] : [])));
  const textureBytesUsed = (textures ?? []).filter((t) => usedTextureIds.has(t.id)).reduce((sum, t) => sum + getTextureByteSize(t), 0);

  // Likewise a sound used by several players is stored once. A player naming a sound the project lacks counts nothing here.
  const usedSoundIds = new Set(nodes.flatMap((node) => (node.audio?.soundId ? [node.audio.soundId] : [])));
  const soundBytesUsed = (sounds ?? []).filter((s) => usedSoundIds.has(s.id)).reduce((sum, s) => sum + getSoundByteSize(s), 0);

  return {
    perScreen,
    totalNodes: nodes.length,
    audioPlayersUsed: nodes.filter((node) => node.kind === "AudioStreamPlayer").length,
    audioChannelsLimit: DS_HARDWARE_PROFILE.audio.channels,
    trianglesUsed,
    trianglesLimit: DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame,
    textureBytesUsed,
    textureBytesLimit: DS_HARDWARE_PROFILE.memory.textureMemoryBytes,
    soundBytesUsed,
    soundBytesLimit: DS_HARDWARE_PROFILE.audio.soundMemoryBytes
  };
}
